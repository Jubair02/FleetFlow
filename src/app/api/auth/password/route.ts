import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";
import { changePasswordSchema, firstError } from "@/lib/validation";
import { clearFailures, recordFailure, retryAfter } from "@/lib/rate-limit";
import { currentSessionTokenHash, deleteOtherSessions } from "@/lib/account";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";

// POST /api/auth/password — the signed-in user changes their own password.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = changePasswordSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { currentPassword, newPassword } = parsed.data;

    // A stolen session must not be able to brute-force the current password.
    const key = `email:${user.email}`;
    const wait = retryAfter(key);
    if (wait > 0) {
      throw new ApiError(429, `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      recordFailure(key);
      throw new ApiError(400, "Your current password is incorrect");
    }
    clearFailures(key);

    const passwordHash = await hashPassword(newPassword);
    const keep = await currentSessionTokenHash();
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
      await deleteOtherSessions(tx, user.id, keep); // sign out every other device
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id,
          detail: { forced: user.mustChangePassword },
        }),
      });
    }, TX_OPTIONS);

    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
