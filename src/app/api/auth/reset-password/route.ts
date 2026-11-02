import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { resetPasswordWithToken } from "@/lib/password-reset";
import { firstError, resetPasswordWithTokenSchema } from "@/lib/validation";

// POST /api/auth/reset-password { token, newPassword } → { success }
// Consumes an emailed "forgot password" link. Every session of the account is
// signed out; the user then signs in with the new password (no auto-login).
export async function POST(req: Request) {
  try {
    const parsed = resetPasswordWithTokenSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    await resetPasswordWithToken(parsed.data.token, parsed.data.newPassword, clientIp(req));
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
