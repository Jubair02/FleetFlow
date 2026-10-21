import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-helpers";
import { getEmailStatus } from "@/lib/email";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { toAdminInfo } from "@/lib/platform-service";
import type { PlatformSettingsData } from "@/lib/platform-types";

// GET /api/platform/settings → PlatformSettingsData (read-only; no secrets or hashes)
export async function GET() {
  try {
    const admin = await requirePlatformAdmin();
    const admins = await db.platformAdmin.findMany({
      select: { id: true, name: true, email: true, mustChangePassword: true, lastLoginAt: true, createdAt: true, active: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const email = getEmailStatus();
    const body: PlatformSettingsData = {
      admin: toAdminInfo(admin),
      platformAdmins: admins.map((a) => ({ ...toAdminInfo(a), active: a.active })),
      environment: {
        emailProvider: email.provider,
        emailConfigured: email.configured,
        signupEnabled: process.env.ALLOW_SIGNUP !== "false",
        demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
      },
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
