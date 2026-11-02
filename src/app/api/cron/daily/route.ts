import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-helpers";
import { issueDueInvoices, type IssueSummary } from "@/lib/billing";
import { cronAuthError } from "@/lib/cron-auth";
import { geocodePendingDeliveries } from "@/lib/geocoding";
import { notifyAdmins } from "@/lib/notify";
import { GRACE_DAYS, subscriptionAccess, type AccessState } from "@/lib/subscription";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

// GET /api/cron/daily — once a day (Vercel Cron, see vercel.json; auth in
// src/lib/cron-auth.ts):
//   1. Subscription reminders: tell a company's staff (in-app + email) when
//      its trial/subscription is about to end, has ended (grace) and has
//      become read-only. Each stage is sent once per end date.
//   2. Invoices: issue renewal invoices due within 7 days (exactly once per
//      period) and mark overdue subscriptions PAST_DUE (src/lib/billing.ts).
//   3. Map points: geocode a capped batch of open deliveries never looked
//      up (src/lib/geocoding.ts; skipped without BARIKOI_API_KEY).
//   4. Housekeeping: delete expired sessions, rate-limit windows and driver
//      positions older than a day.
// Returns counts only.

const REMINDERS: Partial<Record<AccessState, (what: string, ends: string, readOnly: string) => { title: string; body: string }>> = {
  ENDING_SOON: (what, ends) => ({
    title: `Your ${what} ends on ${ends}`,
    body: `Contact FleetFlow to subscribe so you can keep adding deliveries. After ${ends} you'll have ${GRACE_DAYS} days' grace before the account becomes read-only.`,
  }),
  GRACE: (what, _ends, readOnly) => ({
    title: `Your ${what} has ended`,
    body: `Everything keeps working until ${readOnly}. After that the account becomes read-only: you can view and finish deliveries already under way, but not add new ones. Contact FleetFlow to subscribe.`,
  }),
  READ_ONLY: (what) => ({
    title: "Your FleetFlow account is now read-only",
    body: `Your ${what} has ended. You can still view, export and complete deliveries already under way. Contact FleetFlow to subscribe and add new deliveries again.`,
  }),
};

/** "29 Oct 2026" in the company's timezone (emails go out from a UTC server). */
function formatDay(iso: string, timeZone: string): string {
  const opts = { day: "numeric", month: "short", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: DEFAULT_TIMEZONE }).format(new Date(iso));
  }
}

export async function GET(req: Request) {
  const denied = cronAuthError(req);
  if (denied) return denied;

  try {
    const now = new Date();
    const orgs = await db.organization.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, timezone: true, subscriptionStatus: true, trialEndsAt: true, paidUntil: true },
    });

    let remindersSent = 0;
    for (const org of orgs) {
      const access = subscriptionAccess(org, now);
      const make = REMINDERS[access.state];
      if (!make || !access.endsAt) continue;
      // One reminder per stage per end date (extending the trial re-arms them).
      const key = `subscription:${access.state}:${access.endsAt.slice(0, 10)}:${org.id}`;
      const already = await db.notification.findFirst({ where: { dedupeKey: { startsWith: `${key}:` } }, select: { id: true } });
      if (already) continue;
      const what = access.kind === "TRIAL" ? "FleetFlow trial" : "FleetFlow subscription";
      const day = (iso: string) => formatDay(iso, org.timezone);
      const msg = make(what, day(access.endsAt), access.readOnlyAt ? day(access.readOnlyAt) : "");
      try {
        await notifyAdmins(org.id, { type: "SUBSCRIPTION", ...msg }, { email: true, emailDedupeKey: key });
        remindersSent++;
      } catch (e) {
        // One company's failure mustn't stop the others' reminders.
        console.error("[cron] subscription reminder failed:", org.id, e);
      }
    }

    // Invoicing failures are logged and never stop reminders or housekeeping.
    let invoices: IssueSummary | null = null;
    try {
      invoices = await issueDueInvoices(now);
    } catch (e) {
      console.error("[cron] invoice issuing failed:", e);
    }

    // Map points for open deliveries never looked up (capped; null without a Barikoi key).
    let geocoded: Awaited<ReturnType<typeof geocodePendingDeliveries>> = null;
    try {
      geocoded = await geocodePendingDeliveries();
    } catch (e) {
      console.error("[cron] geocoding failed:", e);
    }
    // Live positions are only useful for minutes; never keep an old one around.
    const staleLocations = await db.driverLocation.deleteMany({ where: { recordedAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } });

    const [sessions, platformSessions, rateLimits] = await Promise.all([
      db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.platformSession.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.rateLimit.deleteMany({ where: { resetAt: { lt: now } } }),
    ]);

    return ok({
      success: true,
      organizationsChecked: orgs.length,
      remindersSent,
      invoicesIssued: invoices?.issued ?? 0,
      invoicesAlreadyIssued: invoices?.alreadyIssued ?? 0,
      invoicesFailed: invoices ? invoices.failed : null,
      subscriptionsMarkedPastDue: invoices?.markedPastDue ?? 0,
      expiredSessionsDeleted: sessions.count + platformSessions.count,
      rateLimitRowsDeleted: rateLimits.count,
      deliveriesGeocoded: geocoded?.located ?? 0,
      deliveriesNotGeocoded: geocoded ? geocoded.not_found + geocoded.failed : 0,
      staleDriverLocationsDeleted: staleLocations.count,
    });
  } catch (e) {
    return fail(e);
  }
}
