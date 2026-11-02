import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin, requireStaff } from "@/lib/api-helpers";
import { createZoneSchema, firstError } from "@/lib/validation";
import { TX_OPTIONS } from "@/lib/delivery";
import { lockOrganization } from "@/lib/delivery-service";
import { auditData } from "@/lib/notify";
import { OPEN_STATUSES, ZONE_LIMITS, type ZoneItem } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────
// /api/zones — delivery zones & charges (docs/ZONES.md).
// GET: admins and dispatchers (the delivery form lists zones).
// POST: admins. At most one default zone per organization — setting a new
// default clears the old one in the same transaction (org row locked, so
// two concurrent writes can't both leave a default).
// ─────────────────────────────────────────────────────────────

const DUPLICATE_ZONE_NAME = "A zone with this name already exists";

export async function GET() {
  try {
    const user = await requireStaff();
    const [zones, open] = await Promise.all([
      db.deliveryZone.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      db.delivery.groupBy({
        by: ["zoneId"],
        where: { organizationId: user.organizationId, zoneId: { not: null }, status: { in: [...OPEN_STATUSES] } },
        _count: { _all: true },
      }),
    ]);
    const openMap = new Map(open.map((g) => [g.zoneId, g._count._all]));
    const items: ZoneItem[] = zones.map((z) => ({
      id: z.id,
      name: z.name,
      areas: z.areas,
      baseFeeBdt: z.baseFeeBdt,
      includedKg: z.includedKg,
      perExtraKgBdt: z.perExtraKgBdt,
      codFeePercent: z.codFeePercent,
      codFeeMinBdt: z.codFeeMinBdt,
      isDefault: z.isDefault,
      sortOrder: z.sortOrder,
      active: z.active,
      openDeliveries: openMap.get(z.id) ?? 0,
      createdAt: z.createdAt.toISOString(),
      updatedAt: z.updatedAt.toISOString(),
    }));
    return ok({ items });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = createZoneSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    try {
      const zone = await db.$transaction(async (tx) => {
        await lockOrganization(tx, user.organizationId);
        const existing = await tx.deliveryZone.aggregate({
          where: { organizationId: user.organizationId },
          _count: { _all: true },
          _max: { sortOrder: true },
        });
        if (existing._count._all >= ZONE_LIMITS.zonesMax) throw new ApiError(409, `You can have at most ${ZONE_LIMITS.zonesMax} zones`);
        if (data.isDefault) {
          await tx.deliveryZone.updateMany({ where: { organizationId: user.organizationId, isDefault: true }, data: { isDefault: false } });
        }
        const z = await tx.deliveryZone.create({
          data: { organizationId: user.organizationId, ...data, sortOrder: (existing._max.sortOrder ?? -1) + 1 },
        });
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "ZONE_CREATED", entityType: "DeliveryZone", entityId: z.id,
            detail: { name: z.name, baseFeeBdt: z.baseFeeBdt, areas: z.areas.length, isDefault: z.isDefault },
          }),
        });
        return z;
      }, TX_OPTIONS);
      return ok({ success: true, zoneId: zone.id }, 201);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError(409, DUPLICATE_ZONE_NAME);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
