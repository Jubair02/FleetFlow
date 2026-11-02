import { fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { requirePlatformSession } from "@/lib/platform-auth";
import { mfaCodeSchema, verifySecondFactor } from "@/lib/platform-mfa";
import { parseBody, toAdminInfo } from "@/lib/platform-service";

// POST /api/platform/auth/mfa/verify { code } → { admin, backupCodes?, backupCodesRemaining, redirectTo }
// `code`: 6-digit authenticator code, or (once enrolled) a one-time backup code.
// First enrolment returns the backup codes — the only time they are shown.
export async function POST(req: Request) {
  try {
    const { admin, session } = await requirePlatformSession({ allowMfaPending: true, allowPasswordChangePending: true });
    const { code } = parseBody(mfaCodeSchema, await readJson<unknown>(req));
    const result = await verifySecondFactor(admin, session, code, clientIp(req));
    return ok({
      admin: toAdminInfo(result.admin),
      ...(result.backupCodes ? { backupCodes: result.backupCodes } : {}),
      backupCodesRemaining: result.backupCodesRemaining,
      redirectTo: "/platform",
    });
  } catch (e) {
    return fail(e);
  }
}
