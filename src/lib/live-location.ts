import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { LIVE_LOCATION_MAX_AGE_MS, STOP_SERVICE_MINUTES, inServiceArea, roundCoord, travelMinutes, type LatLng } from "@/lib/geo";

// ─────────────────────────────────────────────────────────────
// Live driver location (plan feature live_map). docs/MAPS.md.
//
// Privacy rules, enforced here and in POST /api/driver/location:
//   • a driver shares only while holding a PICKED_UP / IN_TRANSIT job —
//     never off-shift, never while just ASSIGNED;
//   • only the LATEST position is kept (DriverLocation is upserted, one row
//     per driver) — no history; the row is deleted when the driver's last
//     in-progress job ends, and the daily cron drops anything older;
//   • a position older than LIVE_LOCATION_MAX_AGE_MS is never shown as live;
//   • customers see only the position and an ETA for their OWN in-progress
//     delivery — never the driver's name, phone or vehicle.
// ─────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | typeof db;

/** Statuses during which a driver's position is shared. */
export const SHARING_STATUSES = ["PICKED_UP", "IN_TRANSIT"] as const;
/** The driver app sends about this often (the server accepts one per LOCATION_MIN_INTERVAL_MS). */
export const LOCATION_SEND_INTERVAL_MS = 30_000;
export const LOCATION_MIN_INTERVAL_MS = 15_000;

export const driverLocationSchema = z.object({
  lat: z.number("lat must be a number").min(-90).max(90),
  lng: z.number("lng must be a number").min(-180).max(180),
  /** Metres (GeolocationCoordinates.accuracy). */
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  /** Degrees from north. */
  heading: z.number().min(0).max(360).nullable().optional(),
  /** km/h (the browser reports m/s; the app converts). */
  speedKmh: z.number().min(0).max(300).nullable().optional(),
  /** When the device took the fix (ISO); defaults to now, never in the future. */
  recordedAt: z.string().datetime({ offset: true }).optional(),
});

export type DriverLocationInput = z.output<typeof driverLocationSchema>;

/** Is this position fresh enough to show as live? */
export function isFresh(recordedAt: Date, now = new Date()): boolean {
  return now.getTime() - recordedAt.getTime() <= LIVE_LOCATION_MAX_AGE_MS;
}

/** Device time clamped to [now - max age, now] so a skewed clock can't fake freshness. */
export function clampRecordedAt(raw: string | undefined, now = new Date()): Date {
  const t = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t)) return now;
  return new Date(Math.min(now.getTime(), Math.max(now.getTime() - LIVE_LOCATION_MAX_AGE_MS, t)));
}

/** Rows to store for a fix, or null when the point is outside the service area. */
export function locationRow(input: DriverLocationInput, now = new Date()) {
  const point = { lat: roundCoord(input.lat), lng: roundCoord(input.lng) };
  if (!inServiceArea(point)) return null;
  return {
    ...point,
    accuracyM: input.accuracy ?? null,
    heading: input.heading ?? null,
    speedKmh: input.speedKmh ?? null,
    recordedAt: clampRecordedAt(input.recordedAt, now),
  };
}

/** Does the driver hold a delivery that is picked up or in transit? */
export async function hasInProgressJob(client: Db, driverId: string): Promise<boolean> {
  const n = await client.assignment.count({
    where: { driverId, active: true, delivery: { status: { in: [...SHARING_STATUSES] } } },
  });
  return n > 0;
}

/** Delete the driver's position once they have nothing in progress (call after the change commits). */
export async function clearLocationIfIdle(driverId: string): Promise<void> {
  if (await hasInProgressJob(db, driverId)) return;
  await db.driverLocation.deleteMany({ where: { userId: driverId } });
}

export interface StopForEta {
  id: string;
  lat: number | null;
  lng: number | null;
  routeSeq: number | null;
}

/**
 * Minutes until the driver reaches `target`: drive through the driver's
 * earlier open stops (lower routeSeq, with a map point) in order, spending
 * STOP_SERVICE_MINUTES at each, then on to the target. Without route order
 * it's the direct drive. Null when the target has no point.
 */
export function etaMinutes(driver: LatLng, target: StopForEta, otherStops: StopForEta[]): number | null {
  if (target.lat === null || target.lng === null) return null;
  const earlier =
    target.routeSeq === null
      ? []
      : otherStops
          .filter((s) => s.id !== target.id && s.routeSeq !== null && s.routeSeq < target.routeSeq! && s.lat !== null && s.lng !== null)
          .sort((a, b) => a.routeSeq! - b.routeSeq!);
  let at = driver;
  let minutes = 0;
  for (const s of earlier) {
    const p = { lat: s.lat!, lng: s.lng! };
    minutes += travelMinutes(at, p) + STOP_SERVICE_MINUTES;
    at = p;
  }
  minutes += travelMinutes(at, { lat: target.lat, lng: target.lng });
  return Math.max(1, Math.round(minutes));
}
