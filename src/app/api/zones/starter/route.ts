import { db } from "@/lib/db";
import { fail, ok, requireAdmin } from "@/lib/api-helpers";
import { TX_OPTIONS } from "@/lib/delivery";
import { lockOrganization } from "@/lib/delivery-service";
import { auditData } from "@/lib/notify";
import { cleanAreas, normalizeForMatch, STARTER_ZONES } from "@/lib/zones";

// POST /api/zones/starter (admin) — add the starter price list
// (Inside Dhaka ৳60 / Dhaka suburbs ৳100 / Outside Dhaka ৳120, see
// STARTER_ZONES). Zones whose name already exists are skipped; the
// "Outside Dhaka" fallback only becomes the default when there is none yet.
export async function POST() {
  try {
    const user = await requireAdmin();
    const created = await db.$transaction(async (tx) => {
      await lockOrganization(tx, user.organizationId);
      const existing = await tx.deliveryZone.findMany({
        where: { organizationId: user.organizationId },
        select: { name: true, isDefault: true, sortOrder: true },
      });
      const names = new Set(existing.map((z) => normalizeForMatch(z.name)));
      let hasDefault = existing.some((z) => z.isDefault);
      let sortOrder = existing.reduce((max, z) => Math.max(max, z.sortOrder), -1) + 1;
      const added: string[] = [];
      for (const t of STARTER_ZONES) {
        if (names.has(normalizeForMatch(t.name))) continue;
        const isDefault = t.isDefault && !hasDefault;
        if (isDefault) hasDefault = true;
        await tx.deliveryZone.create({
          data: { organizationId: user.organizationId, ...t, areas: cleanAreas(t.areas), isDefault, sortOrder: sortOrder++ },
        });
        added.push(t.name);
      }
      if (added.length) {
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "ZONE_CREATED", entityType: "DeliveryZone", entityId: "starter",
            detail: { starter: true, names: added },
          }),
        });
      }
      return added;
    }, TX_OPTIONS);
    return ok({ created }, created.length ? 201 : 200);
  } catch (e) {
    return fail(e);
  }
}
