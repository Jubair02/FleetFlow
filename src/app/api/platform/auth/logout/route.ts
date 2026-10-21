import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { destroyPlatformSession, getPlatformAdmin, platformAuditData } from "@/lib/platform-auth";

// POST /api/platform/auth/logout → { success }
// Always clears the cookie (even when the session already expired); only a
// live session produces an audit row.
export async function POST(req: Request) {
  try {
    const admin = await getPlatformAdmin();
    await destroyPlatformSession();
    if (admin) {
      await db.platformAuditLog.create({
        data: platformAuditData({ actor: admin, action: "PLATFORM_LOGOUT", targetType: "PlatformAdmin", targetId: admin.id, ip: clientIp(req) }),
      });
    }
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
