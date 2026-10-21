import { ApiError, fail, ok } from "@/lib/api-helpers";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { toAdminInfo } from "@/lib/platform-service";

// GET /api/platform/auth/me → { admin: PlatformAdminInfo | null }
// Signed out is a normal state for the console, so it answers 200 with null.
export async function GET() {
  try {
    const admin = await requirePlatformAdmin({ allowPasswordChangePending: true });
    return ok({ admin: toAdminInfo(admin) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return ok({ admin: null });
    return fail(e);
  }
}
