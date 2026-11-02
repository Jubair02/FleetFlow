import { fail, ok } from "@/lib/api-helpers";
import { cronAuthError } from "@/lib/cron-auth";
import { retryDueNotifications } from "@/lib/notify";
import { dispatchDueWebhooks, pruneWebhookDeliveries } from "@/lib/webhooks";

export const maxDuration = 60;

// GET /api/cron/outbox — automatic outbox retry (Vercel Cron, see vercel.json).
// Auth: see src/lib/cron-auth.ts. Re-dispatches up to 50 due email/SMS rows
// across all organizations, then up to 100 due webhook deliveries (within a
// time budget) and prunes webhook rows past retention. Returns counts only.
// Webhooks are mostly sent right after each change (src/lib/webhooks.ts);
// this sweep catches retries for companies with no activity since.
export async function GET(req: Request) {
  const denied = cronAuthError(req);
  if (denied) return denied;

  try {
    const summary = await retryDueNotifications();
    const webhooks = await dispatchDueWebhooks({ limit: 100, budgetMs: 40_000, concurrency: 5 });
    const pruned = await pruneWebhookDeliveries();
    return ok({ success: true, ...summary, webhooks: { ...webhooks, pruned } });
  } catch (e) {
    return fail(e);
  }
}
