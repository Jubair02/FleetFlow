import { db } from "@/lib/db";
import { ApiError, fail, ok } from "@/lib/api-helpers";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { countOrgData } from "@/lib/platform-service";
import type { OrgDeletePreview, OrgStatus } from "@/lib/platform-types";

type Params = { params: Promise<{ id: string }> };

// GET /api/platform/organizations/[id]/delete-preview → OrgDeletePreview
// Read-only: what DELETE /api/platform/organizations/[id] would remove (org-scoped counts).
export async function GET(_req: Request, { params }: Params) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const org = await db.organization.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
    if (!org) throw new ApiError(404, "Organization not found");
    const body: OrgDeletePreview = { name: org.name, status: org.status as OrgStatus, counts: await countOrgData(db, org.id) };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
