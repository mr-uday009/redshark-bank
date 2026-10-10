/**
 * Join class names, dropping anything falsy.
 *
 * A tiny stand-in for the `clsx` + `tailwind-merge` pair that shadcn normally
 * pulls in — this project has no such dependency and the conditional cases here
 * are simple enough not to need conflict resolution.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

/** "45 seconds" / "2 minutes" — for rate-limit messages. */
function humaniseWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Turn an auth API error payload into something worth showing a user.
 * A 429 carries `retryAfterSeconds`, which is far more useful than a bare
 * "try again" — it tells them whether to wait or come back later.
 */
export function formatAuthError(data: {
  error?: string;
  retryAfterSeconds?: number;
}): string {
  const base = data.error ?? "Something went wrong.";
  if (typeof data.retryAfterSeconds === "number" && data.retryAfterSeconds > 0) {
    return `${base} Try again in ${humaniseWait(data.retryAfterSeconds)}.`;
  }
  return base;
}
