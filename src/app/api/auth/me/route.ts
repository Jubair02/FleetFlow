import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fail, ok } from "@/lib/api-helpers";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ user: null }, 200);

    const unread = await db.notification.count({
      where: { userId: user.id, channel: "IN_APP", readAt: null },
    });

    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: user.organization.name,
        driverProfile: user.driverProfile,
      },
      unreadNotifications: unread,
    });
  } catch (e) {
    return fail(e);
  }
}
