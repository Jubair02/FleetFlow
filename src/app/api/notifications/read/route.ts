import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";
import { firstError } from "@/lib/validation";

// { all: true } marks everything read; { ids: [...] } marks specific notifications.
const markReadSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).max(200, "Too many notifications at once").optional(),
  all: z.boolean().optional(),
});

// POST /api/notifications/read — mark the current user's in-app notifications as read
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = markReadSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { ids, all } = parsed.data;

    if (all) {
      await db.notification.updateMany({
        where: { userId: user.id, channel: "IN_APP", readAt: null },
        data: { readAt: new Date() },
      });
    } else if (ids?.length) {
      await db.notification.updateMany({
        where: { userId: user.id, channel: "IN_APP", id: { in: ids }, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
