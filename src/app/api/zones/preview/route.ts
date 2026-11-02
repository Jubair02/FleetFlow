import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireStaff } from "@/lib/api-helpers";
import { firstError, zonePreviewSchema } from "@/lib/validation";
import { loadZones } from "@/lib/zone-service";
import { calculateFee, resolveZone, type ZonePreview } from "@/lib/zones";

// POST /api/zones/preview { address, weightKg?, codAmount?, zoneId? } (staff)
// → the zone the delivery would get and its fee breakdown. Read-only; used
// live by the delivery form and the "Test an address" box in Settings.
export async function POST(req: Request) {
  try {
    const user = await requireStaff();
    const parsed = zonePreviewSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { address, weightKg, codAmount, zoneId } = parsed.data;

    const zones = await loadZones(db, user.organizationId);
    const match = resolveZone(zones, address, zoneId);
    if (zoneId && !match.zone) throw new ApiError(400, "Choose an active delivery zone");
    const preview: ZonePreview = {
      zone: match.zone ? { id: match.zone.id, name: match.zone.name } : null,
      kind: match.kind,
      matchedArea: match.matchedArea,
      fee: match.zone ? calculateFee(match.zone, { weightKg, codAmount }) : null,
      zonesConfigured: zones.some((z) => z.active),
    };
    return ok(preview);
  } catch (e) {
    return fail(e);
  }
}
