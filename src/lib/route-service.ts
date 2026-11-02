import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import type { SessionUser } from "@/lib/auth";
import { TX_OPTIONS, lockDriver, table } from "@/lib/delivery";
import { LIVE_LOCATION_MAX_AGE_MS, toLatLng, type LatLng } from "@/lib/geo";
import { auditData } from "@/lib/notify";
import { assertFeature } from "@/lib/plans";
import { computeEtas, optimizeRoute } from "@/lib/route-optimizer";
import type { RoutePlan, RouteStart, RouteStop } from "@/lib/route-types";

// ─────────────────────────────────────────────────────────────
// Route planning for one driver (/api/routes, docs/ROUTES.md): read the
// open stops in route order, optimise them, or save a manual order.
// Saving writes Delivery.routeSeq / routePlannedAt / plannedEta for every
// open stop in one transaction. closeAssignment() (src/lib/delivery.ts)
// clears a stop's fields when it leaves the driver and renumbers the rest.
// Needs the live_map plan feature.
// ─────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

/** A driver's stops still on their route. */
export const OPEN_ROUTE_STATUSES = ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] as const;
/** Largest route the planner will save (well above any driver's capacity). */
export const MAX_ROUTE_STOPS = 300;

const driverId = z.string({ message: "Choose a driver" }).trim().min(1, "Choose a driver").max(64);
export const optimizeRouteSchema = z.object({ driverId });
export const reorderRouteSchema = z.object({
  driverId,
  order: z
    .array(z.string().trim().min(1).max(64), { message: "Send the stop order as a list of delivery ids" })
    .max(MAX_ROUTE_STOPS, `A route can have at most ${MAX_ROUTE_STOPS} stops`)
    .refine((ids) => new Set(ids).size === ids.length, "Each stop may appear only once"),
});

const STOP_SELECT = {
  id: true,
  trackingCode: true,
  recipientName: true,
  deliveryAddress: true,
  status: true,
  priority: true,
  expectedAt: true,
  deliveryLat: true,
  deliveryLng: true,
  routeSeq: true,
  routePlannedAt: true,
  plannedEta: true,
} satisfies Prisma.DeliverySelect;

type StopRow = Prisma.DeliveryGetPayload<{ select: typeof STOP_SELECT }>;

/** Route order: planned stops by routeSeq, then unplanned ones by expected time and age. */
const STOP_ORDER: Prisma.DeliveryOrderByWithRelationInput[] = [
  { routeSeq: { sort: "asc", nulls: "last" } },
  { expectedAt: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
];

async function findDriver(tx: Tx, organizationId: string, id: string) {
  const driver = await tx.user.findFirst({ where: { id, organizationId, role: "DRIVER" }, select: { id: true, name: true } });
  if (!driver) throw new ApiError(404, "Driver not found");
  return driver;
}

function openStops(tx: Tx, organizationId: string, driverId: string): Promise<StopRow[]> {
  return tx.delivery.findMany({
    where: { organizationId, status: { in: [...OPEN_ROUTE_STATUSES] }, assignments: { some: { active: true, driverId } } },
    orderBy: STOP_ORDER,
    select: STOP_SELECT,
    take: MAX_ROUTE_STOPS + 1,
  });
}

interface ResolvedStart {
  point: LatLng;
  source: "DRIVER" | "DEPOT";
  recordedAt: Date | null;
}

/** Fresh driver GPS, else the company depot, else null (the route starts at its first located stop). */
async function resolveStart(tx: Tx, organizationId: string, driverId: string, now: Date): Promise<ResolvedStart | null> {
  const [loc, org] = await Promise.all([
    tx.driverLocation.findUnique({ where: { userId: driverId }, select: { organizationId: true, lat: true, lng: true, recordedAt: true } }),
    tx.organization.findUnique({ where: { id: organizationId }, select: { pickupLat: true, pickupLng: true } }),
  ]);
  const live = loc && loc.organizationId === organizationId && now.getTime() - loc.recordedAt.getTime() <= LIVE_LOCATION_MAX_AGE_MS ? toLatLng(loc.lat, loc.lng) : null;
  if (live) return { point: live, source: "DRIVER", recordedAt: loc!.recordedAt };
  const depot = org ? toLatLng(org.pickupLat, org.pickupLng) : null;
  return depot ? { point: depot, source: "DEPOT", recordedAt: null } : null;
}

const pointOf = (s: StopRow) => ({ id: s.id, lat: s.deliveryLat, lng: s.deliveryLng });

function toPlan(driver: { id: string; name: string }, start: ResolvedStart | null, stops: StopRow[], now: Date): RoutePlan {
  const est = computeEtas(start?.point ?? null, stops.map(pointOf), now);
  let routeStart: RouteStart | null = start
    ? { lat: start.point.lat, lng: start.point.lng, source: start.source, recordedAt: start.recordedAt?.toISOString() ?? null }
    : null;
  if (!routeStart) {
    const first = stops.map((s) => toLatLng(s.deliveryLat, s.deliveryLng)).find(Boolean);
    if (first) routeStart = { lat: first.lat, lng: first.lng, source: "FIRST_STOP", recordedAt: null };
  }
  const plannedAt = stops.reduce<Date | null>((max, s) => (s.routePlannedAt && (!max || s.routePlannedAt > max) ? s.routePlannedAt : max), null);
  return {
    driver,
    start: routeStart,
    stops: stops.map(
      (s, i): RouteStop => ({
        id: s.id,
        trackingCode: s.trackingCode,
        recipientName: s.recipientName,
        deliveryAddress: s.deliveryAddress,
        status: s.status,
        priority: s.priority,
        expectedAt: s.expectedAt?.toISOString() ?? null,
        lat: s.deliveryLat,
        lng: s.deliveryLng,
        routeSeq: s.routeSeq,
        plannedEta: s.plannedEta?.toISOString() ?? null,
        legKm: est.stops[i].legKm === null ? null : Math.round(est.stops[i].legKm! * 10) / 10,
      })
    ),
    totals: { km: Math.round(est.totalKm * 10) / 10, minutes: Math.round(est.totalMinutes) },
    plannedAt: plannedAt?.toISOString() ?? null,
    unlocatedCount: stops.filter((s) => !toLatLng(s.deliveryLat, s.deliveryLng)).length,
  };
}

function assertRouteSize(stops: StopRow[]) {
  if (stops.length > MAX_ROUTE_STOPS) throw new ApiError(409, `This driver has more than ${MAX_ROUTE_STOPS} open stops — the route is too long to plan`);
}

/** GET: the driver's open stops in saved route order with live totals. */
export async function getRoutePlan(user: SessionUser, driverId: string): Promise<RoutePlan> {
  await assertFeature(db, user.organizationId, "live_map");
  const driver = await findDriver(db, user.organizationId, driverId);
  const now = new Date();
  const [stops, start] = await Promise.all([openStops(db, user.organizationId, driverId), resolveStart(db, user.organizationId, driverId, now)]);
  assertRouteSize(stops);
  return toPlan(driver, start, stops, now);
}

export type SaveRouteMode = { kind: "optimize" } | { kind: "manual"; order: string[] };

/**
 * Optimise or reorder a driver's route and save routeSeq / plannedEta for
 * every open stop. Locks follow the global order (Delivery → DriverProfile):
 * the open stops' rows first, then the driver, then a re-read that must
 * match — a stop assigned or closed meanwhile means "refresh and retry".
 */
export async function saveRoute(user: SessionUser, driverId: string, mode: SaveRouteMode): Promise<RoutePlan> {
  const organizationId = user.organizationId;
  await assertFeature(db, organizationId, "live_map");
  const driver = await findDriver(db, organizationId, driverId);
  const candidates = await openStops(db, organizationId, driverId);
  assertRouteSize(candidates);
  if (!candidates.length) throw new ApiError(409, `${driver.name} has no open stops to plan`);

  return db.$transaction(async (tx) => {
    const ids = candidates.map((s) => s.id).sort();
    await tx.$queryRaw`SELECT id FROM ${table("Delivery")} WHERE id IN (${Prisma.join(ids)}) AND "organizationId" = ${organizationId} ORDER BY id FOR UPDATE`;
    await lockDriver(tx, driverId);
    const stops = await openStops(tx, organizationId, driverId);
    const current = stops.map((s) => s.id).sort();
    if (current.length !== ids.length || current.some((id, i) => id !== ids[i])) {
      throw new ApiError(409, `${driver.name}'s stops changed while planning — refresh and try again`);
    }

    const now = new Date();
    const start = await resolveStart(tx, organizationId, driverId, now);
    let order: string[];
    if (mode.kind === "optimize") {
      order = optimizeRoute(
        start?.point ?? null,
        stops.map((s) => ({
          id: s.id,
          lat: s.deliveryLat,
          lng: s.deliveryLng,
          priority: s.priority,
          expectedAt: s.expectedAt,
          seq: s.routeSeq,
          // the driver has already set off for an in-transit delivery
          fixedFirst: s.status === "IN_TRANSIT",
        }))
      );
    } else {
      const sent = [...mode.order].sort();
      if (sent.length !== current.length || sent.some((id, i) => id !== current[i])) {
        throw new ApiError(409, `The order must list exactly ${driver.name}'s ${current.length} open stop${current.length === 1 ? "" : "s"} — refresh and try again`);
      }
      order = mode.order;
    }

    const byId = new Map(stops.map((s) => [s.id, s]));
    const ordered = order.map((id) => byId.get(id)!);
    const est = computeEtas(start?.point ?? null, ordered.map(pointOf), now);
    const saved: StopRow[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const data = { routeSeq: i + 1, routePlannedAt: now, plannedEta: est.stops[i].eta };
      await tx.delivery.update({ where: { id: ordered[i].id }, data });
      saved.push({ ...ordered[i], ...data });
    }

    await tx.auditLog.create({
      data: auditData({
        organizationId,
        actorId: user.id,
        actorName: user.name,
        action: mode.kind === "optimize" ? "ROUTE_OPTIMIZED" : "ROUTE_REORDERED",
        entityType: "User",
        entityId: driverId,
        detail: {
          driver: driver.name,
          stops: ordered.length,
          km: Math.round(est.totalKm * 10) / 10,
          minutes: Math.round(est.totalMinutes),
          start: start?.source ?? "FIRST_STOP",
          order: ordered.map((s) => s.trackingCode),
        },
      }),
    });
    return toPlan(driver, start, saved, now);
  }, TX_OPTIONS);
}
