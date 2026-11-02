import { db } from "@/lib/db";
import { fail, ok, requireStaff } from "@/lib/api-helpers";
import { assertFeature } from "@/lib/plans";
import { geocodingEnabled } from "@/lib/barikoi";
import { TERMINAL_STATUSES } from "@/lib/constants";
import { LIVE_LOCATION_MAX_AGE_MS, toLatLng } from "@/lib/geo";
import type { LiveMapData, MapDriver } from "@/lib/map-types";

/** Pins drawn at most — beyond this the screen says the list is capped. */
const MAX_DELIVERIES = 1000;

/**
 * GET /api/map — the live map (staff; plan feature live_map → 403 without).
 * Depot, drivers with a FRESH position (≤ LIVE_LOCATION_MAX_AGE_MS), open
 * deliveries that have a map point (routeSeq = the driver's stop order) and
 * how many open deliveries still have none. Polled every ~30 s.
 */
export async function GET() {
  try {
    const user = await requireStaff();
    const organizationId = user.organizationId;
    await assertFeature(db, organizationId, "live_map");
    const now = new Date();
    const open = { organizationId, status: { notIn: [...TERMINAL_STATUSES] } };

    const [org, locations, deliveries, openTotal, missingLocation] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { pickupLat: true, pickupLng: true, defaultPickupAddress: true } }),
      db.driverLocation.findMany({
        where: { organizationId, recordedAt: { gte: new Date(now.getTime() - LIVE_LOCATION_MAX_AGE_MS) }, user: { active: true, role: "DRIVER" } },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              assignments: { where: { active: true }, orderBy: { assignedAt: "desc" }, select: { vehicle: { select: { registrationNumber: true } } } },
            },
          },
        },
      }),
      db.delivery.findMany({
        where: { ...open, deliveryLat: { not: null }, deliveryLng: { not: null } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_DELIVERIES + 1,
        select: {
          id: true, trackingCode: true, recipientName: true, deliveryAddress: true, status: true, priority: true,
          deliveryLat: true, deliveryLng: true, routeSeq: true,
          assignments: { where: { active: true }, select: { driverId: true } },
        },
      }),
      db.delivery.count({ where: open }),
      db.delivery.count({ where: { ...open, OR: [{ deliveryLat: null }, { deliveryLng: null }] } }),
    ]);

    const drivers: MapDriver[] = locations.map((l) => ({
      id: l.user.id,
      name: l.user.name,
      vehicle: l.user.assignments[0]?.vehicle?.registrationNumber ?? null,
      lat: l.lat,
      lng: l.lng,
      accuracyM: l.accuracyM,
      heading: l.heading,
      recordedAt: l.recordedAt.toISOString(),
      jobs: l.user.assignments.length,
    }));

    const depot = org ? toLatLng(org.pickupLat, org.pickupLng) : null;
    const body: LiveMapData = {
      depot: depot ? { ...depot, address: org?.defaultPickupAddress ?? null } : null,
      drivers,
      deliveries: deliveries.slice(0, MAX_DELIVERIES).map((d) => ({
        id: d.id,
        trackingCode: d.trackingCode,
        recipientName: d.recipientName,
        deliveryAddress: d.deliveryAddress,
        status: d.status,
        priority: d.priority,
        lat: d.deliveryLat!,
        lng: d.deliveryLng!,
        driverId: d.assignments[0]?.driverId ?? null,
        routeSeq: d.routeSeq,
      })),
      missingLocation,
      openTotal,
      capped: deliveries.length > MAX_DELIVERIES,
      geocoding: geocodingEnabled(),
      generatedAt: now.toISOString(),
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
