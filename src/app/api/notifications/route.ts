import { db } from "@/lib/db";
import { ApiError, fail, ok, requireUser } from "@/lib/api-helpers";
import { getEmailStatus } from "@/lib/email";
import { MAX_ATTEMPTS } from "@/lib/email/outbox";
import { isStaffRole } from "@/lib/roles";
import { getSmsStatus } from "@/lib/sms";

// GET /api/notifications — the signed-in user's in-app notifications
// GET /api/notifications?channel=EMAIL — staff view of the org's outbox (email and SMS rows)
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const channel = url.searchParams.get("channel") === "EMAIL" ? "EMAIL" : "IN_APP";

    if (channel === "EMAIL") {
      if (!isStaffRole(user.role)) throw new ApiError(403, "Admin or dispatcher access required");
      // The org's outbox: driver/admin emails, customer emails and customer SMS (no user account)
      const outbound = { in: ["EMAIL", "SMS"] };
      // Dispatchers see delivery messages only: billing, subscription and account
      // emails (no deliveryId) are for admins.
      const scope = user.role === "ADMIN" ? {} : { deliveryId: { not: null } };
      const [items, failedRetryable] = await Promise.all([
        db.notification.findMany({
          where: { channel: outbound, organizationId: user.organizationId, ...scope },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
        }),
        db.notification.count({
          where: { channel: outbound, organizationId: user.organizationId, ...scope, status: "FAILED", attempts: { lt: MAX_ATTEMPTS } },
        }),
      ]);
      return ok({
        channel,
        emailStatus: getEmailStatus(),
        smsStatus: getSmsStatus(),
        maxAttempts: MAX_ATTEMPTS,
        failedRetryable,
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          channel: n.channel,
          recipientEmail: n.recipientEmail,
          recipientPhone: n.recipientPhone,
          deliveryId: n.deliveryId,
          readAt: n.readAt ? n.readAt.toISOString() : null,
          createdAt: n.createdAt.toISOString(),
          // legacy rows created before the outbox existed have no status — they were simulated
          status: n.status ?? "SIMULATED",
          attempts: n.attempts,
          sentAt: n.status === "SENT" || n.status === "SIMULATED" ? (n.sentAt ? n.sentAt.toISOString() : null) : null,
          lastError: n.status === "FAILED" ? n.lastError : null,
        })),
      });
    }

    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId: user.id, channel: "IN_APP" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      }),
      db.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } }),
    ]);

    return ok({
      channel,
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        deliveryId: n.deliveryId,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
