/**
 * Token-bucket rate limiting for the auth endpoints.
 *
 * How a token bucket works
 * ------------------------
 * Each key (an IP, or a username) owns a bucket holding at most `capacity`
 * tokens. The bucket refills continuously at `refillPerSecond`. Every request
 * removes one token; a request with no tokens left is rejected.
 *
 * This shape is deliberately different from a fixed window ("N per minute"):
 *
 *   - A fixed window lets a caller fire the full quota at 10:59:59 and the
 *     full quota again at 11:00:00 — twice the intended rate across the
 *     boundary.
 *   - A bucket smooths that out. Capacity also allows a legitimate burst
 *     (someone mistyping their password four times in a row) without
 *     permanently penalising them.
 *
 * Storage is an in-process Map. That is correct for this deployment — a single
 * Next.js server. It is NOT shared across instances, so if the app is ever
 * scaled horizontally this must move to Redis or similar, or each instance
 * will enforce its own independent quota.
 */

export type RateLimitPolicy = {
  /** Maximum tokens a bucket can hold — the largest allowed burst. */
  capacity: number;
  /** Tokens restored per second. capacity/refillPerSecond = full refill time. */
  refillPerSecond: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until at least one token is available. 0 when allowed. */
  retryAfterSeconds: number;
};

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Buckets whose tokens have fully refilled carry no information — they are
 * indistinguishable from a key that has never been seen. Sweeping them keeps
 * the map bounded by the number of *currently throttled* keys rather than by
 * every key ever seen.
 */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepMs = 0;

function sweep(nowMs: number, policies: Map<string, RateLimitPolicy>) {
  if (nowMs - lastSweepMs < SWEEP_INTERVAL_MS) return;
  lastSweepMs = nowMs;

  for (const [key, bucket] of buckets) {
    const policy = policies.get(policyNameOf(key));
    if (!policy) {
      buckets.delete(key);
      continue;
    }
    const refilled =
      bucket.tokens + ((nowMs - bucket.lastRefillMs) / 1000) * policy.refillPerSecond;
    if (refilled >= policy.capacity) buckets.delete(key);
  }
}

/** Keys are stored as "<policy>:<value>" so one map can serve every policy. */
function policyNameOf(key: string): string {
  const idx = key.indexOf(":");
  return idx === -1 ? key : key.slice(0, idx);
}

const activePolicies = new Map<string, RateLimitPolicy>();

function policyKey(policyName: string, value: string) {
  return `${policyName}:${value}`;
}

/**
 * Remove one token from the bucket for `value` under `policyName`.
 * Pure function of the bucket state — safe to call on every request.
 */
export function consumeToken(
  policyName: string,
  policy: RateLimitPolicy,
  value: string,
): RateLimitResult {
  const nowMs = Date.now();
  activePolicies.set(policyName, policy);
  sweep(nowMs, activePolicies);

  const key = policyKey(policyName, value);
  const existing = buckets.get(key);

  const bucket: Bucket = existing ?? { tokens: policy.capacity, lastRefillMs: nowMs };

  // Refill for the time that has passed, capped at capacity.
  const elapsedSeconds = (nowMs - bucket.lastRefillMs) / 1000;
  bucket.tokens = Math.min(
    policy.capacity,
    bucket.tokens + elapsedSeconds * policy.refillPerSecond,
  );
  bucket.lastRefillMs = nowMs;

  if (bucket.tokens < 1) {
    // Not enough for this request. Report how long until one token exists.
    const secondsUntilToken = (1 - bucket.tokens) / policy.refillPerSecond;
    buckets.set(key, bucket);
    return {
      allowed: false,
      limit: policy.capacity,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(secondsUntilToken)),
    };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);

  return {
    allowed: true,
    limit: policy.capacity,
    remaining: Math.floor(bucket.tokens),
    retryAfterSeconds: 0,
  };
}

/**
 * Put a bucket back to full.
 *
 * Used after a *successful* login so a legitimate user who mistyped their
 * password a few times is not left throttled. Deliberately applied only to the
 * per-account bucket, never the per-IP one: one person's successful sign-in
 * should not refill the quota that protects everyone behind the same NAT.
 */
export function resetBucket(policyName: string, value: string): void {
  buckets.delete(policyKey(policyName, value));
}

/** Test/maintenance hook. */
export function clearAllBuckets(): void {
  buckets.clear();
}
