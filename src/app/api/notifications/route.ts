import { db } from "@/lib/db";
import { ApiError, fail, ok, requireUser } from "@/lib/api-helpers";
import { getEmailStatus } from "@/lib/email";
import { MAX_ATTEMPTS } from "@/lib/email/outbox";

// GET /api/notifications — the signed-in user's in-app notifications
// GET /api/notifications?channel=EMAIL — admin view of the org's email outbox
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const channel = url.searchParams.get("channel") === "EMAIL" ? "EMAIL" : "IN_APP";

    if (channel === "EMAIL") {
      if (user.role !== "ADMIN") throw new ApiError(403, "Admin access required");
      // The org's email outbox: driver/admin emails and customer emails (no user account)
      const [items, failedRetryable] = await Promise.all([
        db.notification.findMany({
          where: { channel: "EMAIL", organizationId: user.organizationId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
        }),
        db.notification.count({
          where: { channel: "EMAIL", organizationId: user.organizationId, status: "FAILED", attempts: { lt: MAX_ATTEMPTS } },
        }),
      ]);
      return ok({
        channel,
        emailStatus: getEmailStatus(),
        maxAttempts: MAX_ATTEMPTS,
        failedRetryable,
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          recipientEmail: n.recipientEmail,
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
