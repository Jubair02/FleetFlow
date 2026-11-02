import { db } from "@/lib/db";
import { ApiError, fail, ok, requireStaff } from "@/lib/api-helpers";
import { hitRateLimit } from "@/lib/api-rate-limit";
import { geocodingEnabled } from "@/lib/barikoi";
import { geocodeDelivery } from "@/lib/geocoding";
import { toDeliveryDTO } from "@/lib/serializers";

type Params = { params: Promise<{ id: string }> };

/** Lookups per company per minute — Locate is a manual retry, not a bulk tool. */
const LOCATE_PER_MINUTE = 30;

/**
 * POST /api/deliveries/[id]/locate — look the delivery address up again now
 * (staff). Replaces a GEOCODED point; a point someone set (PIN, API, DRIVER)
 * is never overwritten — move the pin instead. 503 without a Barikoi key.
 * Returns the delivery and whether a point was found.
 */
export async function POST(_req: Request, { params }: Params) {
  try {
    const user = await requireStaff();
    const { id } = await params;
    const delivery = await db.delivery.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true, status: true, deliveryLat: true, geoSource: true },
    });
    if (!delivery) throw new ApiError(404, "Delivery not found");
    if (!geocodingEnabled()) throw new ApiError(503, "Address lookup isn't set up yet — drop a pin on the map instead");
    if (delivery.status === "DELIVERED" || delivery.status === "CANCELLED") {
      throw new ApiError(409, "Delivered or cancelled deliveries can't be located again");
    }
    if (delivery.deliveryLat !== null && delivery.geoSource !== "GEOCODED") {
      throw new ApiError(409, "This location was set by hand or by the driver — move the pin to change it");
    }

    const hit = await hitRateLimit(`locate:${user.organizationId}`, LOCATE_PER_MINUTE, 60_000);
    if (!hit.allowed) throw new ApiError(429, `Too many lookups — try again in ${hit.retryAfter} s`);

    // drop the old lookup (only if it's still a GEOCODED one) so geocodeDelivery fills it afresh
    await db.delivery.updateMany({
      where: { id, geoSource: "GEOCODED" },
      data: { deliveryLat: null, deliveryLng: null, geoSource: null },
    });
    const outcome = await geocodeDelivery(id);

    const full = await db.delivery.findUniqueOrThrow({
      where: { id },
      include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } },
    });
    return ok({ delivery: toDeliveryDTO(full, true), located: outcome === "located" });
  } catch (e) {
    return fail(e);
  }
}
