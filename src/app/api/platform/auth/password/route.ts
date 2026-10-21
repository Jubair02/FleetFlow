import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clearFailures, recordFailure, retryAfter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/account";
import { TX_OPTIONS } from "@/lib/delivery";
import { currentPlatformTokenHash, platformAuditData, requirePlatformAdmin } from "@/lib/platform-auth";
import { parseBody, platformPasswordSchema, toAdminInfo } from "@/lib/platform-service";

// POST /api/platform/auth/password {currentPassword, newPassword} → { admin }
export async function POST(req: Request) {
  try {
    const admin = await requirePlatformAdmin({ allowPasswordChangePending: true });
    const { currentPassword, newPassword } = parseBody(platformPasswordSchema, await readJson<unknown>(req));

    // A stolen session must not be able to brute-force the current password.
    const key = `platform-email:${admin.email}`;
    const wait = retryAfter(key);
    if (wait > 0) {
      throw new ApiError(429, `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
    }
    if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
      recordFailure(key);
      throw new ApiError(400, "Your current password is incorrect");
    }
    clearFailures(key);

    const passwordHash = await hashPassword(newPassword);
    const keep = await currentPlatformTokenHash();
    const updated = await db.$transaction(async (tx) => {
      const a = await tx.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash, mustChangePassword: false } });
      // Sign out every other device.
      await tx.platformSession.deleteMany({ where: { adminId: admin.id, ...(keep ? { token: { not: keep } } : {}) } });
      await tx.platformAuditLog.create({
        data: platformAuditData({
          actor: admin, action: "PLATFORM_PASSWORD_CHANGED", targetType: "PlatformAdmin", targetId: admin.id,
          detail: { forced: admin.mustChangePassword }, ip: clientIp(req),
        }),
      });
      return a;
    }, TX_OPTIONS);

    return ok({ admin: toAdminInfo(updated) });
  } catch (e) {
    return fail(e);
  }
}
