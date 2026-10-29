import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// Fixed-window failure limiter, stored in Postgres (model RateLimit) so it
// holds across serverless instances and restarts. Each key counts failures
// for 15 minutes from the first one; at the limit, the key is blocked until
// the window ends.
// ─────────────────────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1000;
// Per-account limit stops password guessing; the per-client limit is looser
// so a shared office IP isn't locked out by a few typos.
const MAX_FAILURES: Record<string, number> = { email: 5, ip: 30 };

function maxFor(key: string): number {
  return MAX_FAILURES[key.split(":")[0]] ?? 5;
}

/** Seconds until the key may try again, or 0 if it isn't blocked. */
export async function retryAfter(key: string): Promise<number> {
  const entry = await db.rateLimit.findUnique({ where: { key } });
  const now = Date.now();
  if (!entry || entry.resetAt.getTime() <= now || entry.count < maxFor(key)) return 0;
  return Math.ceil((entry.resetAt.getTime() - now) / 1000);
}

export async function recordFailure(key: string, attempt = 0): Promise<void> {
  const now = new Date();
  // Within an open window: atomic increment, so concurrent failures all count.
  const bumped = await db.rateLimit.updateMany({
    where: { key, resetAt: { gt: now } },
    data: { count: { increment: 1 } },
  });
  if (bumped.count === 0) {
    // No row, or its window expired: start a new window at 1.
    const resetAt = new Date(now.getTime() + WINDOW_MS);
    try {
      await db.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, resetAt },
        update: { count: 1, resetAt },
      });
    } catch (e) {
      // A concurrent request created the row first — count against it instead.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt === 0) {
        return recordFailure(key, 1);
      }
      throw e;
    }
  }
  // Expired rows are useless; sweep them now and then instead of on every call.
  if (Math.random() < 0.02) {
    await db.rateLimit.deleteMany({ where: { resetAt: { lt: now } } }).catch(() => {});
  }
}

export async function clearFailures(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}
