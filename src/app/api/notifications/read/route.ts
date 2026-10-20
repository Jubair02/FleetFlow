import { db } from "@/lib/db";
import { fail, ok, readJson, requireUser } from "@/lib/api-helpers";

// POST /api/notifications/read — mark notifications as read
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<{ ids?: string[]; all?: boolean }>(req).catch(() => ({}) as { ids?: string[]; all?: boolean });

    if (body.all) {
      await db.notification.updateMany({
        where: { userId: user.id, channel: "IN_APP", readAt: null },
        data: { readAt: new Date() },
      });
    } else if (Array.isArray(body.ids) && body.ids.length) {
      await db.notification.updateMany({
        where: { userId: user.id, channel: "IN_APP", id: { in: body.ids }, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
