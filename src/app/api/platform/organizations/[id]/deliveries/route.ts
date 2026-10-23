import { db } from "@/lib/db";
import { ApiError, fail, ok } from "@/lib/api-helpers";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { ORG_DELIVERY_SELECT, orgDeliveriesQuery, paged, parseQuery, toOrgDeliveryRow } from "@/lib/platform-service";
import type { Paged, PlatformOrgDeliveryRow } from "@/lib/platform-types";

type Params = { params: Promise<{ id: string }> };

// GET /api/platform/organizations/[id]/deliveries?page=&pageSize= → Paged<PlatformOrgDeliveryRow>
// Read-only, newest first, scoped to this one organization. The explicit select
// never returns tracking tokens, recipient phone/email or addresses.
export async function GET(req: Request, { params }: Params) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const { page, pageSize } = parseQuery(orgDeliveriesQuery, new URL(req.url).searchParams, ["page", "pageSize"]);

    const org = await db.organization.findUnique({ where: { id }, select: { id: true } });
    if (!org) throw new ApiError(404, "Organization not found");

    const where = { organizationId: org.id };
    const [total, rows] = await Promise.all([
      db.delivery.count({ where }),
      db.delivery.findMany({
        where,
        select: ORG_DELIVERY_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const body: Paged<PlatformOrgDeliveryRow> = paged(rows.map(toOrgDeliveryRow), total, page, pageSize);
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
