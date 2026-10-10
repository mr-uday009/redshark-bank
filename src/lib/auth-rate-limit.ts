/**
 * Rate-limit policy for the auth endpoints, plus the request helpers that
 * apply it.
 *
 * Two independent dimensions are enforced on login:
 *
 *   - per IP       — stops one host hammering the endpoint
 *   - per account  — stops a distributed attack on a single username, which
 *                    the IP bucket alone would never catch
 *
 * Register is per-IP only; there is no account to key on yet.
 *
 * Limits are read from the environment so they can be loosened for local
 * testing without editing code — see .env.example.
 */

import { NextResponse } from "next/server";
import { consumeToken, resetBucket, type RateLimitPolicy } from "@/lib/rate-limit";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** capacity = largest burst; capacity/refillPerSecond = seconds to refill. */
function policy(capacityEnv: string, refillEnv: string, capacity: number, seconds: number): RateLimitPolicy {
  const cap = envNumber(capacityEnv, capacity);
  const window = envNumber(refillEnv, seconds);
  return { capacity: cap, refillPerSecond: cap / window };
}

export const LOGIN_IP = policy("RATE_LIMIT_LOGIN_IP_MAX", "RATE_LIMIT_LOGIN_IP_WINDOW", 20, 300);
export const LOGIN_ACCOUNT = policy("RATE_LIMIT_LOGIN_ACCT_MAX", "RATE_LIMIT_LOGIN_ACCT_WINDOW", 5, 300);
export const REGISTER_IP = policy("RATE_LIMIT_REGISTER_IP_MAX", "RATE_LIMIT_REGISTER_IP_WINDOW", 5, 3600);

/**
 * Transfers are limited per *user*, not per IP — the caller is authenticated,
 * so the account is the meaningful identity. This is a guard against a runaway
 * loop or a stolen session draining an account, not against anonymous abuse.
 */
export const TRANSFER_USER = policy("RATE_LIMIT_TRANSFER_MAX", "RATE_LIMIT_TRANSFER_WINDOW", 10, 60);

const POLICY_NAMES = {
  loginIp: "login-ip",
  loginAccount: "login-account",
  registerIp: "register-ip",
  transferUser: "transfer-user",
} as const;

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is client-controllable unless a trusted proxy overwrites
 * it, so this is a throttle, not an authorization control — an attacker who
 * can spoof the header can rotate the key. That is an accepted trade-off here;
 * the per-account bucket is the one that actually protects credentials.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function tooManyRequests(result: { limit: number; retryAfterSeconds: number }) {
  return NextResponse.json(
    {
      error: "Too many attempts. Please wait and try again.",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}

/**
 * First gate: the per-IP bucket. Cheap and needs no body, so the route can run
 * it before parsing anything.
 */
export function checkLoginIpRateLimit(request: Request): NextResponse | null {
  const ip = consumeToken(POLICY_NAMES.loginIp, LOGIN_IP, clientIp(request));
  return ip.allowed ? null : tooManyRequests(ip);
}

/**
 * Second gate: the per-account bucket. Needs the submitted identifier, so it
 * runs after the body is parsed.
 */
export function checkLoginAccountRateLimit(identifier: string): NextResponse | null {
  const account = consumeToken(
    POLICY_NAMES.loginAccount,
    LOGIN_ACCOUNT,
    identifier.trim().toLowerCase(),
  );
  return account.allowed ? null : tooManyRequests(account);
}

/** Check the bucket for a registration attempt. */
export function checkRegisterRateLimit(request: Request): NextResponse | null {
  const ip = consumeToken(POLICY_NAMES.registerIp, REGISTER_IP, clientIp(request));
  if (!ip.allowed) return tooManyRequests(ip);
  return null;
}

/**
 * Check the bucket for a money transfer. Keyed on the signed-in user rather
 * than the IP, since the caller is authenticated and the account is the
 * meaningful identity.
 */
export function checkTransferRateLimit(
  request: Request,
  username: string,
): NextResponse | null {
  void request;
  const user = consumeToken(
    POLICY_NAMES.transferUser,
    TRANSFER_USER,
    username.trim().toLowerCase(),
  );
  return user.allowed ? null : tooManyRequests(user);
}

/**
 * Clear the per-account bucket after a successful sign-in, so someone who
 * mistyped their password a few times is not left waiting. The per-IP bucket
 * is intentionally left alone.
 */
export function clearLoginFailuresFor(identifier: string): void {
  resetBucket(POLICY_NAMES.loginAccount, identifier.trim().toLowerCase());
}
