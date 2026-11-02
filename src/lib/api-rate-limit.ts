import { db } from "@/lib/db";
import { table } from "@/lib/delivery";

// ─────────────────────────────────────────────────────────────
// Fixed-window request counter for the public API, stored in the same
// Postgres RateLimit table as the login limiter (src/lib/rate-limit.ts) so
// it holds across serverless instances. One atomic upsert per request:
// a new or expired window restarts at 1, otherwise the count goes up.
// Keys are namespaced ("api:<apiKeyId>") and never collide with the
// login limiter's "email:" / "ip:" keys; its sweep of expired rows
// cleans these up too.
// ─────────────────────────────────────────────────────────────

export interface WindowHit {
  allowed: boolean;
  /** Requests counted in the current window, this one included. */
  count: number;
  limit: number;
  remaining: number;
  resetAt: Date;
  /** Seconds until the window resets (0 when allowed). */
  retryAfter: number;
}

export async function hitRateLimit(key: string, limit: number, windowMs: number, now = new Date()): Promise<WindowHit> {
  const freshReset = new Date(now.getTime() + windowMs);
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO ${table("RateLimit")} AS rl ("key", "count", "resetAt")
    VALUES (${key}, 1, ${freshReset})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN rl."resetAt" <= ${now} THEN 1 ELSE rl."count" + 1 END,
      "resetAt" = CASE WHEN rl."resetAt" <= ${now} THEN ${freshReset} ELSE rl."resetAt" END
    RETURNING "count", "resetAt"`;
  const row = rows[0] ?? { count: 1, resetAt: freshReset };
  const count = Number(row.count);
  const resetAt = new Date(row.resetAt);
  const allowed = count <= limit;
  return {
    allowed,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
  };
}
