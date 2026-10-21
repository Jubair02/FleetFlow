import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fail, ok } from "@/lib/api-helpers";
import { sessionUserDto } from "@/lib/account";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ user: null }, 200);

    const unread = await db.notification.count({
      where: { userId: user.id, channel: "IN_APP", readAt: null },
    });

    return ok({
      user: sessionUserDto(user),
      unreadNotifications: unread,
    });
  } catch (e) {
    return fail(e);
  }
}
