import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin, requireUser } from "@/lib/api-helpers";
import { updateOrgSchema, firstError } from "@/lib/validation";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import type { Organization, Prisma } from "@prisma/client";

const ORG_FIELDS = {
  id: true,
  name: true,
  plan: true,
  phone: true,
  contactEmail: true,
  address: true,
  defaultPickupAddress: true,
  timezone: true,
  createdAt: true,
} as const;

type OrgRow = Pick<Organization, keyof typeof ORG_FIELDS>;

function serializeOrg(o: OrgRow) {
  return { ...o, createdAt: o.createdAt.toISOString() };
}

// GET /api/org — company profile & settings (any signed-in member of the org)
export async function GET() {
  try {
    const user = await requireUser();
    const org = await db.organization.findUnique({ where: { id: user.organizationId }, select: ORG_FIELDS });
    if (!org) throw new ApiError(404, "Organization not found");
    return ok({ organization: serializeOrg(org) });
  } catch (e) {
    return fail(e);
  }
}

const EDITABLE = ["name", "phone", "contactEmail", "address", "defaultPickupAddress", "timezone"] as const;

// PATCH /api/org — update company profile & settings (admin). Empty strings clear optional fields.
export async function PATCH(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = updateOrgSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const input = parsed.data;

    const org = await db.$transaction(async (tx) => {
      const current = await tx.organization.findUnique({ where: { id: user.organizationId }, select: ORG_FIELDS });
      if (!current) throw new ApiError(404, "Organization not found");

      const data: Prisma.OrganizationUpdateInput = {};
      for (const key of EDITABLE) {
        const value = input[key];
        if (value === undefined) continue;
        if (key === "name" || key === "timezone") {
          if (value && value !== current[key]) data[key] = value; // required fields can't be cleared
          continue;
        }
        const next = value === "" ? null : value;
        if (next !== current[key]) data[key] = next;
      }
      if (Object.keys(data).length === 0) return current;

      const updated = await tx.organization.update({ where: { id: user.organizationId }, data, select: ORG_FIELDS });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "ORG_SETTINGS_UPDATED", entityType: "Organization", entityId: user.organizationId,
          detail: { changed: Object.keys(data) },
        }),
      });
      return updated;
    }, TX_OPTIONS);

    return ok({ organization: serializeOrg(org) });
  } catch (e) {
    return fail(e);
  }
}
