import { after } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { geocodeAddress, geocodingEnabled } from "@/lib/barikoi";
import { TERMINAL_STATUSES } from "@/lib/constants";
import { inServiceArea, isValidLatLng, roundCoord, type LatLng } from "@/lib/geo";

// ─────────────────────────────────────────────────────────────
// Where a delivery goes on the map (Delivery.deliveryLat/deliveryLng).
//
// geoSource says who set the point:
//   PIN       staff dropped it on the map (create/edit dialog)
//   API       the public API caller sent `location`
//   DRIVER    the driver's GPS when they recorded proof of delivery
//   GEOCODED  looked up from the address with Barikoi (src/lib/barikoi.ts)
// A geocode only ever fills an EMPTY point — it never replaces PIN, API or
// DRIVER. Changing the address drops a GEOCODED point and looks it up again.
//
// Geocoding runs after the response (next/server after()), a few at a time
// and capped per request; the daily cron picks up whatever was missed.
// geocodeAttemptedAt is stamped even when nothing is found, so a bad
// address isn't retried forever (the Locate action forces a retry). Without
// BARIKOI_API_KEY nothing is attempted or stamped, so adding a key later
// lets the cron fill in the backlog.
// ─────────────────────────────────────────────────────────────

export type GeoSource = "GEOCODED" | "PIN" | "DRIVER" | "API";

/** Lookups in flight at once (Barikoi rate limits are per key). */
export const GEOCODE_CONCURRENCY = 4;
/** Deliveries geocoded after a single request (bulk imports beyond this wait for the cron or Locate). */
export const GEOCODE_PER_REQUEST = 100;
/** Deliveries the daily cron geocodes per run. */
export const GEOCODE_CRON_BATCH = 200;

/** Run `fn` over `items` with at most `limit` in flight; results in input order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * Validate a staff/API supplied point: both halves or neither, finite, inside
 * Bangladesh. Returns the rounded point, null when not sent, or throws 400.
 */
export function parseDeliveryPoint(lat: number | null | undefined, lng: number | null | undefined, what = "delivery location"): LatLng | null {
  if (lat == null && lng == null) return null;
  if (lat == null || lng == null) throw new ApiError(400, `Send both latitude and longitude for the ${what}`);
  if (!isValidLatLng(lat, lng)) throw new ApiError(400, `The ${what} is not a valid coordinate`);
  if (!inServiceArea({ lat, lng })) throw new ApiError(400, `The ${what} must be inside Bangladesh`);
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

/** Columns for a point someone supplied. */
export function pointData(point: LatLng, source: Exclude<GeoSource, "GEOCODED">) {
  return { deliveryLat: point.lat, deliveryLng: point.lng, geoSource: source };
}

const CLEARED = { deliveryLat: null, deliveryLng: null, geoSource: null, geocodeAttemptedAt: null };

export interface CoordinateUpdate {
  /** Columns to write (empty = leave the point alone). */
  data: Partial<{ deliveryLat: number | null; deliveryLng: number | null; geoSource: string | null; geocodeAttemptedAt: Date | null }>;
  /** Look the (new) address up after saving. */
  geocode: boolean;
}

/**
 * What an edit does to the point. `pin`: a new point (→ PIN), null to remove
 * it (→ geocode the address again), undefined when not sent.
 */
export function planCoordinateUpdate(
  current: { deliveryLat: number | null; deliveryLng: number | null; geoSource: string | null },
  pin: LatLng | null | undefined,
  addressChanged: boolean
): CoordinateUpdate {
  if (pin) {
    const same = current.geoSource === "PIN" && current.deliveryLat === pin.lat && current.deliveryLng === pin.lng;
    return { data: same ? {} : pointData(pin, "PIN"), geocode: false };
  }
  const hasPoint = current.deliveryLat !== null && current.deliveryLng !== null;
  if (pin === null) return { data: hasPoint || current.geoSource ? CLEARED : {}, geocode: true };
  if (!addressChanged) return { data: {}, geocode: false };
  if (!hasPoint) return { data: { geocodeAttemptedAt: null }, geocode: true };
  if (current.geoSource === "GEOCODED") return { data: CLEARED, geocode: true };
  return { data: {}, geocode: false }; // a PIN/API/DRIVER point stays — staff can move it
}

export type GeocodeOutcome = "located" | "not_found" | "skipped";

/**
 * Geocode one delivery's address if it still has no point. The write is
 * conditional (still no point, same address), so a pin dropped or an address
 * edited meanwhile always wins over this lookup.
 */
export async function geocodeDelivery(deliveryId: string): Promise<GeocodeOutcome> {
  if (!geocodingEnabled()) return "skipped";
  const d = await db.delivery.findUnique({
    where: { id: deliveryId },
    select: { deliveryAddress: true, deliveryLat: true, deliveryLng: true },
  });
  if (!d || d.deliveryLat !== null || d.deliveryLng !== null) return "skipped";
  const hit = await geocodeAddress(d.deliveryAddress);
  const res = await db.delivery.updateMany({
    where: { id: deliveryId, deliveryLat: null, deliveryLng: null, deliveryAddress: d.deliveryAddress },
    data: {
      geocodeAttemptedAt: new Date(),
      ...(hit ? { deliveryLat: hit.lat, deliveryLng: hit.lng, geoSource: "GEOCODED" } : {}),
    },
  });
  if (res.count === 0) return "skipped";
  return hit ? "located" : "not_found";
}

/**
 * Geocode several deliveries, a few at a time; one failure never stops the
 * rest. No new lookup starts after `budgetMs` (those count as skipped).
 */
export async function geocodeDeliveries(ids: string[], budgetMs = 60_000): Promise<Record<GeocodeOutcome | "failed", number>> {
  const counts = { located: 0, not_found: 0, skipped: 0, failed: 0 };
  if (!geocodingEnabled() || ids.length === 0) return { ...counts, skipped: ids.length };
  const deadline = Date.now() + budgetMs;
  await mapWithConcurrency(ids, GEOCODE_CONCURRENCY, async (id) => {
    if (Date.now() > deadline) {
      counts.skipped++;
      return;
    }
    try {
      counts[await geocodeDelivery(id)]++;
    } catch (e) {
      counts.failed++;
      console.error("[geocode] delivery failed:", id, e instanceof Error ? e.message : e);
    }
  });
  return counts;
}

/**
 * Geocode these deliveries after the response is sent (capped per request).
 * A no-op without BARIKOI_API_KEY. Call after the write has committed.
 */
export function geocodeDeliveriesSoon(ids: string[]): void {
  if (!geocodingEnabled() || ids.length === 0) return;
  const batch = ids.slice(0, GEOCODE_PER_REQUEST);
  const work = () => geocodeDeliveries(batch).catch(() => undefined);
  try {
    after(work);
  } catch {
    // outside a request (scripts/tests): run without blocking the caller
    void work();
  }
}

/** Cron: open deliveries that were never looked up (oldest first, capped). */
export async function geocodePendingDeliveries(limit = GEOCODE_CRON_BATCH) {
  if (!geocodingEnabled()) return null;
  const rows = await db.delivery.findMany({
    where: {
      deliveryLat: null,
      geocodeAttemptedAt: null,
      status: { notIn: [...TERMINAL_STATUSES] },
      organization: { status: "ACTIVE" },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return geocodeDeliveries(rows.map((r) => r.id));
}
