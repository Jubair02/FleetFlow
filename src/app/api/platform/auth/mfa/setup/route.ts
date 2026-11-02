import { fail, ok } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { requirePlatformSession } from "@/lib/platform-auth";
import { beginEnrollment } from "@/lib/platform-mfa";

// POST /api/platform/auth/mfa/setup → { otpauthUri, qrDataUrl, manualKey }
// Only for a password-verified (pending) session of an admin without two-factor
// yet. Calling it again replaces the unconfirmed secret.
export async function POST(req: Request) {
  try {
    const { admin, session } = await requirePlatformSession({ allowMfaPending: true, allowPasswordChangePending: true });
    const setup = await beginEnrollment(admin, session, clientIp(req));
    return ok(setup);
  } catch (e) {
    return fail(e);
  }
}
