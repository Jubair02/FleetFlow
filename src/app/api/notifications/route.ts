import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";

// GET /api/notifications — the signed-in user's in-app notifications
// GET /api/notifications?channel=EMAIL — admin view of the org's email outbox
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const channel = url.searchParams.get("channel") === "EMAIL" ? "EMAIL" : "IN_APP";

    if (channel === "EMAIL") {
      if (user.role !== "ADMIN") throw new ApiError(403, "Admin access required");
      const admins = await db.user.findMany({
        where: { organizationId: user.organizationId, role: "ADMIN" },
        select: { id: true },
      });
      const items = await db.notification.findMany({
        where: { channel: "EMAIL", userId: { in: admins.map((a) => a.id) } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return ok({
        channel,
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          recipientEmail: n.recipientEmail,
          deliveryId: n.deliveryId,
          readAt: n.readAt ? n.readAt.toISOString() : null,
          createdAt: n.createdAt.toISOString(),
        })),
      });
    }

    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId: user.id, channel: "IN_APP" },
        orderBy: { createdAt: "desc" },
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
