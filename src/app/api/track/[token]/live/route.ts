import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/account";
import { hitRateLimit } from "@/lib/api-rate-limit";
import { barikoiStyleUrl } from "@/lib/barikoi";
import { orgHasFeature } from "@/lib/plans";
import { isValidTrackingToken } from "@/lib/tracking";
import { toLatLng } from "@/lib/geo";
import { SHARING_STATUSES, etaMinutes, isFresh } from "@/lib/live-location";
import type { TrackingLive } from "@/lib/map-types";

type Params = { params: Promise<{ token: string }> };

const NO_STORE = { "Cache-Control": "no-store" };
/** Requests per tracking link + client per minute (the page polls every 30 s). */
const LIVE_PER_MINUTE = 20;

/**
 * GET /api/track/[token]/live — public: where the driver is, for the
 * recipient's OWN delivery while it is on its way (docs/MAPS.md).
 *
 * Answers {} unless ALL of: tracking is on, the sender's plan includes
 * live_map, the delivery is PICKED_UP / IN_TRANSIT, and the assigned
 * driver's position is fresh. Then { driver: { lat, lng, recordedAt },
 * destination, etaMinutes, styleUrl }. NEVER the driver's name, phone,
 * vehicle, other stops or anything else about the driver.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    const { token } = await params;
    if (!isValidTrackingToken(token)) return NextResponse.json({}, { status: 404, headers: NO_STORE });

    const hit = await hitRateLimit(`track-live:${token}:${clientIp(req)}`, LIVE_PER_MINUTE, 60_000);
    if (!hit.allowed) {
      return NextResponse.json({}, { status: 429, headers: { ...NO_STORE, "Retry-After": String(hit.retryAfter) } });
    }

    const delivery = await db.delivery.findUnique({
      where: { trackingToken: token },
      select: {
        id: true, organizationId: true, trackingEnabled: true, status: true,
        deliveryLat: true, deliveryLng: true, routeSeq: true,
        assignments: { where: { active: true }, select: { driverId: true } },
      },
    });
    const empty = NextResponse.json({} satisfies TrackingLive, { headers: NO_STORE });
    if (!delivery || !delivery.trackingEnabled) return empty;
    if (!(SHARING_STATUSES as readonly string[]).includes(delivery.status)) return empty;
    const driverId = delivery.assignments[0]?.driverId;
    if (!driverId) return empty;
    if (!(await orgHasFeature(db, delivery.organizationId, "live_map"))) return empty;

    const loc = await db.driverLocation.findUnique({ where: { userId: driverId }, select: { lat: true, lng: true, recordedAt: true } });
    if (!loc || !isFresh(loc.recordedAt)) return empty;

    // the driver's other open stops ahead of this one (route order), for the estimate only
    const others =
      delivery.routeSeq !== null
        ? await db.delivery.findMany({
            where: {
              organizationId: delivery.organizationId,
              id: { not: delivery.id },
              status: { in: ["ASSIGNED", ...SHARING_STATUSES] },
              routeSeq: { lt: delivery.routeSeq },
              assignments: { some: { driverId, active: true } },
            },
            select: { id: true, deliveryLat: true, deliveryLng: true, routeSeq: true },
            take: 50,
          })
        : [];

    const destination = toLatLng(delivery.deliveryLat, delivery.deliveryLng);
    const stop = (d: { id: string; deliveryLat: number | null; deliveryLng: number | null; routeSeq: number | null }) => ({
      id: d.id, lat: d.deliveryLat, lng: d.deliveryLng, routeSeq: d.routeSeq,
    });
    const body: TrackingLive = {
      driver: { lat: loc.lat, lng: loc.lng, recordedAt: loc.recordedAt.toISOString() },
      destination,
      etaMinutes: etaMinutes({ lat: loc.lat, lng: loc.lng }, stop(delivery), others.map(stop)),
      styleUrl: barikoiStyleUrl(),
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (e) {
    console.error("[track live] error:", e);
    return NextResponse.json({}, { status: 500, headers: NO_STORE });
  }
}
