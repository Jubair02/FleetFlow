import { db } from "@/lib/db";
import { getDummyHash, verifyPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clearFailures, recordFailure, retryAfter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/account";
import { createPlatformSession, platformAuditData } from "@/lib/platform-auth";
import { parseBody, platformLoginSchema, toAdminInfo } from "@/lib/platform-service";

// POST /api/platform/auth/login {email, password} → { admin }
// Separate from tenant login: only PlatformAdmin rows can sign in here.
export async function POST(req: Request) {
  try {
    const { email, password } = parseBody(platformLoginSchema, await readJson<unknown>(req));
    const ip = clientIp(req);

    const keys = [`platform-email:${email}`, `ip:${ip}`];
    const wait = Math.max(...keys.map(retryAfter));
    if (wait > 0) {
      throw new ApiError(429, `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
    }

    const admin = await db.platformAdmin.findUnique({ where: { email } });
    // Always run scrypt so unknown emails take as long as known ones.
    const passwordOk = await verifyPassword(password, admin?.passwordHash ?? (await getDummyHash()));
    if (!admin || !passwordOk || !admin.active) {
      keys.forEach(recordFailure);
      if (admin) {
        await db.platformAuditLog.create({
          data: platformAuditData({
            actor: null, action: "PLATFORM_LOGIN_FAILED", targetType: "PlatformAdmin", targetId: admin.id,
            detail: { reason: !passwordOk ? "bad-credentials" : "inactive" }, ip,
          }),
        });
      }
      throw new ApiError(401, "Invalid email or password");
    }
    clearFailures(keys[0]); // only the account key — a valid login must not reset the per-client counter

    const updated = await db.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await createPlatformSession(admin.id);
    await db.platformAuditLog.create({
      data: platformAuditData({ actor: admin, action: "PLATFORM_LOGIN", targetType: "PlatformAdmin", targetId: admin.id, ip }),
    });

    return ok({ admin: toAdminInfo(updated) });
  } catch (e) {
    return fail(e);
  }
}
