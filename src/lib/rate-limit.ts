// ─────────────────────────────────────────────────────────────
// In-memory fixed-window limiter for login attempts. Per server
// process — swap for Redis/DB if the app runs on several instances.
// ─────────────────────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1000;
// Per-account limit stops password guessing; the per-client limit is looser
// so a shared office IP isn't locked out by a few typos.
const MAX_FAILURES: Record<string, number> = { email: 5, ip: 30 };

function maxFor(key: string): number {
  return MAX_FAILURES[key.split(":")[0]] ?? 5;
}

const failures = new Map<string, { count: number; resetAt: number }>();

function prune(now: number) {
  if (failures.size < 5000) return;
  for (const [key, entry] of failures) if (entry.resetAt <= now) failures.delete(key);
}

/** Seconds until the key may try again, or 0 if it isn't blocked. */
export function retryAfter(key: string): number {
  const entry = failures.get(key);
  const now = Date.now();
  if (!entry || entry.resetAt <= now || entry.count < maxFor(key)) return 0;
  return Math.ceil((entry.resetAt - now) / 1000);
}

export function recordFailure(key: string): void {
  const now = Date.now();
  prune(now);
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
