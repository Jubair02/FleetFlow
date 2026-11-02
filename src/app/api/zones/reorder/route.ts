import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { firstError, reorderZonesSchema } from "@/lib/validation";
import { TX_OPTIONS } from "@/lib/delivery";
import { lockOrganization } from "@/lib/delivery-service";
import { auditData } from "@/lib/notify";

// POST /api/zones/reorder { ids } (admin) — the organization's zones in their
// new matching order (first = tried first). Must list every zone exactly once.
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = reorderZonesSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { ids } = parsed.data;

    await db.$transaction(async (tx) => {
      await lockOrganization(tx, user.organizationId);
      const zones = await tx.deliveryZone.findMany({ where: { organizationId: user.organizationId }, select: { id: true, sortOrder: true } });
      const known = new Set(zones.map((z) => z.id));
      if (new Set(ids).size !== ids.length || ids.length !== zones.length || ids.some((id) => !known.has(id))) {
        throw new ApiError(409, "The zone list changed — reload and try again");
      }
      const current = new Map(zones.map((z) => [z.id, z.sortOrder]));
      const moved = ids.filter((id, i) => current.get(id) !== i);
      if (!moved.length) return;
      for (const id of moved) {
        await tx.deliveryZone.update({ where: { id }, data: { sortOrder: ids.indexOf(id) } });
      }
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "ZONES_REORDERED", entityType: "DeliveryZone", entityId: ids[0],
          detail: { order: ids },
        }),
      });
    }, TX_OPTIONS);
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
