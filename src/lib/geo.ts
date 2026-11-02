// ─────────────────────────────────────────────────────────────
// Shared geography maths for the map, route planning and arrival estimates.
// Pure (no DB, no network) so server, client and tests share one definition.
//
// Distances are straight-line (haversine) stretched by ROAD_FACTOR to
// approximate road distance; speeds are city averages. These are estimates —
// good enough to order stops and give customers a window, not navigation.
// ─────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

/** Straight line → typical road distance in Dhaka-like street grids. */
export const ROAD_FACTOR = 1.35;
/** Average door-to-door speed for a city delivery vehicle, km/h. */
export const DEFAULT_SPEED_KMH = 18;
/** Time spent at each stop (parking, handover, proof), minutes. */
export const STOP_SERVICE_MINUTES = 6;
/** A driver position older than this is not shown as "live". */
export const LIVE_LOCATION_MAX_AGE_MS = 10 * 60 * 1000;

/** Bangladesh, padded — points outside are almost certainly a typo or swapped lat/lng. */
const SERVICE_BOUNDS = { minLat: 20.3, maxLat: 26.8, minLng: 87.8, maxLng: 92.9 };

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road distance in kilometres. */
export function roadKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

/** Estimated driving minutes between two points (no stop time). */
export function travelMinutes(a: LatLng, b: LatLng, speedKmh = DEFAULT_SPEED_KMH): number {
  return (roadKm(a, b) / speedKmh) * 60;
}

/** A finite, in-range coordinate pair. */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

/** Inside the area FleetFlow serves (Bangladesh). */
export function inServiceArea(p: LatLng): boolean {
  return p.lat >= SERVICE_BOUNDS.minLat && p.lat <= SERVICE_BOUNDS.maxLat && p.lng >= SERVICE_BOUNDS.minLng && p.lng <= SERVICE_BOUNDS.maxLng;
}

/** Point from nullable columns, or null when either half is missing. */
export function toLatLng(lat: number | null | undefined, lng: number | null | undefined): LatLng | null {
  return lat != null && lng != null && isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/** Round to ~1 m (5 decimals) before storing or sending. */
export function roundCoord(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
