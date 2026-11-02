import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { firstError, updateZoneSchema } from "@/lib/validation";
import { TX_OPTIONS } from "@/lib/delivery";
import { lockOrganization } from "@/lib/delivery-service";
import { auditData } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

const DUPLICATE_ZONE_NAME = "A zone with this name already exists";

// PATCH /api/zones/[id] — edit a zone (admin). Existing deliveries keep their
// fee; POST /api/zones/recalculate re-prices open ones.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const parsed = updateZoneSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    try {
      await db.$transaction(async (tx) => {
        await lockOrganization(tx, user.organizationId);
        const zone = await tx.deliveryZone.findFirst({ where: { id, organizationId: user.organizationId } });
        if (!zone) throw new ApiError(404, "Zone not found");

        const fields = (Object.keys(data) as (keyof typeof data)[]).filter((k) => {
          const next = data[k];
          const cur = zone[k];
          return Array.isArray(next) && Array.isArray(cur) ? next.join("\u0000") !== cur.join("\u0000") : next !== cur;
        });
        if (!fields.length) return;

        if (data.isDefault) {
          await tx.deliveryZone.updateMany({
            where: { organizationId: user.organizationId, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
        }
        await tx.deliveryZone.update({ where: { id }, data: Object.fromEntries(fields.map((f) => [f, data[f]])) });
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "ZONE_UPDATED", entityType: "DeliveryZone", entityId: id,
            detail: { name: data.name ?? zone.name, fields },
          }),
        });
      }, TX_OPTIONS);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError(409, DUPLICATE_ZONE_NAME);
      throw e;
    }
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/zones/[id] — remove a zone (admin). Deliveries in it lose the
// zone link (FK SET NULL) but keep the fee they were charged; the settings
// screen suggests turning the zone off instead while it has open deliveries.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    await db.$transaction(async (tx) => {
      await lockOrganization(tx, user.organizationId);
      const zone = await tx.deliveryZone.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { _count: { select: { deliveries: true } } },
      });
      if (!zone) throw new ApiError(404, "Zone not found");
      await tx.deliveryZone.delete({ where: { id } });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "ZONE_DELETED", entityType: "DeliveryZone", entityId: id,
          detail: { name: zone.name, deliveries: zone._count.deliveries },
        }),
      });
    }, TX_OPTIONS);
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
