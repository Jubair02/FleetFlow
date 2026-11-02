import { fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { mfaCodeSchema, regenerateBackupCodes } from "@/lib/platform-mfa";
import { parseBody } from "@/lib/platform-service";

// POST /api/platform/auth/mfa/backup-codes { code } → { backupCodes }
// Replaces every backup code; requires a current authenticator code.
// There is deliberately no endpoint that turns two-factor off.
export async function POST(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const { code } = parseBody(mfaCodeSchema, await readJson<unknown>(req));
    const backupCodes = await regenerateBackupCodes(admin, code, clientIp(req));
    return ok({ backupCodes });
  } catch (e) {
    return fail(e);
  }
}
