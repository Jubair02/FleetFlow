import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { firstError, recalculateFeesSchema } from "@/lib/validation";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { loadZones } from "@/lib/zone-service";
import { OPEN_STATUSES, repriceCharge } from "@/lib/zones";

// POST /api/zones/recalculate { cursor? } (admin) — re-price open deliveries
// whose fee wasn't typed by staff, with the zones' CURRENT prices
// (repriceCharge in src/lib/zones.ts). Finished deliveries are never touched.
// One bounded batch per call, in id order; while `nextCursor` is non-null,
// call again with it.
const BATCH = 500;

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = recalculateFeesSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const cursor = parsed.data.cursor ?? null;

    const result = await db.$transaction(async (tx) => {
      const zones = await loadZones(tx, user.organizationId);
      const rows = await tx.delivery.findMany({
        where: {
          organizationId: user.organizationId,
          status: { in: [...OPEN_STATUSES] },
          feeOverridden: false,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: BATCH + 1,
        select: { id: true, status: true, deliveryAddress: true, weightKg: true, codAmount: true, zoneId: true, deliveryFeeBdt: true, feeOverridden: true },
      });
      const more = rows.length > BATCH;
      const batch = rows.slice(0, BATCH);

      // Group identical results so a batch is a handful of updateMany calls.
      const groups = new Map<string, { zoneId: string | null; deliveryFeeBdt: number | null; ids: string[] }>();
      for (const d of batch) {
        const plan = repriceCharge(d, zones);
        if (plan.zoneId === d.zoneId && plan.deliveryFeeBdt === d.deliveryFeeBdt) continue;
        const key = `${plan.zoneId ?? ""}|${plan.deliveryFeeBdt ?? ""}`;
        const g = groups.get(key) ?? { zoneId: plan.zoneId, deliveryFeeBdt: plan.deliveryFeeBdt, ids: [] };
        g.ids.push(d.id);
        groups.set(key, g);
      }
      let updated = 0;
      for (const g of groups.values()) {
        const res = await tx.delivery.updateMany({
          // re-check inside the write: a delivery that finished or got an override meanwhile is skipped
          where: { id: { in: g.ids }, organizationId: user.organizationId, status: { in: [...OPEN_STATUSES] }, feeOverridden: false },
          data: { zoneId: g.zoneId, deliveryFeeBdt: g.deliveryFeeBdt },
        });
        updated += res.count;
      }
      if (updated) {
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "DELIVERY_FEES_RECALCULATED", entityType: "DeliveryZone", entityId: "all",
            detail: { checked: batch.length, updated },
          }),
        });
      }
      return { checked: batch.length, updated, nextCursor: more ? batch[batch.length - 1].id : null };
    }, TX_OPTIONS);

    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
