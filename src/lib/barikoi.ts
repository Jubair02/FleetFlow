import { inServiceArea, isValidLatLng, roundCoord, type LatLng } from "@/lib/geo";

// ─────────────────────────────────────────────────────────────
// Barikoi (Bangladesh maps) — server-side lookups. docs/MAPS.md.
//
//   BARIKOI_API_KEY  geocoding, address search, reverse geocoding.
//                    Server only: it is never sent to the browser.
//   BARIKOI_MAP_KEY  map tiles/style in the browser (visible to anyone
//                    who opens a map). Falls back to BARIKOI_API_KEY, but a
//                    separate key restricted to your domain is recommended.
//
// Without keys everything degrades quietly: lookups return null/[] and maps
// use OpenStreetMap's raster tiles. Every call has a timeout, response shapes
// are checked defensively (numbers often arrive as strings), and the key is
// never logged — errors are reported without the request URL.
// ─────────────────────────────────────────────────────────────

const BASE_URL = "https://barikoi.xyz";
const MAP_STYLE_URL = "https://map.barikoi.com/styles/osm-liberty/style.json";
const TIMEOUT_MS = 6_000;
/** Rupantor confidence (percent) below which a geocode is treated as "not found". */
export const MIN_GEOCODE_CONFIDENCE = 40;

/** Key for server lookups, or null when geocoding is not configured. */
export function barikoiApiKey(): string | null {
  return process.env.BARIKOI_API_KEY?.trim() || null;
}

/** Key the browser uses for map tiles (BARIKOI_MAP_KEY, else BARIKOI_API_KEY). */
export function barikoiMapKey(): string | null {
  return process.env.BARIKOI_MAP_KEY?.trim() || barikoiApiKey();
}

export function geocodingEnabled(): boolean {
  return barikoiApiKey() !== null;
}

/** Barikoi map style URL for MapLibre, or null without a map key. */
export function barikoiStyleUrl(): string | null {
  const key = barikoiMapKey();
  return key ? `${MAP_STYLE_URL}?key=${encodeURIComponent(key)}` : null;
}

export interface GeocodeResult extends LatLng {
  /** 0–100; Barikoi's own confidence score. */
  confidence: number;
  /** Address as Barikoi understood it. */
  formatted: string | null;
}

export interface PlaceSuggestion extends LatLng {
  address: string;
  addressBn: string | null;
  area: string | null;
  city: string | null;
}

export interface ReverseGeocodeResult {
  address: string | null;
  area: string | null;
  city: string | null;
}

// ── response parsing (pure) ──────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A number from a number or numeric string. */
export function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A usable point inside the service area, rounded for storage — else null. */
export function servicePoint(lat: unknown, lng: unknown): LatLng | null {
  const la = num(lat);
  const ln = num(lng);
  if (!isValidLatLng(la, ln)) return null;
  const p = { lat: roundCoord(la as number), lng: roundCoord(ln as number) };
  return inServiceArea(p) ? p : null;
}

/** Rupantor geocode response → result, or null when unusable (no point, outside Bangladesh, low confidence). */
export function parseGeocode(body: unknown): GeocodeResult | null {
  if (!isObj(body)) return null;
  const geo = isObj(body.geocoded_address) ? body.geocoded_address : null;
  if (!geo) return null;
  const point = servicePoint(geo.latitude, geo.longitude);
  if (!point) return null;
  const confidence = num(body.confidence_score_percentage) ?? 0;
  if (confidence < MIN_GEOCODE_CONFIDENCE) return null;
  return { ...point, confidence, formatted: str(geo.address) ?? str(body.fixed_address) };
}

/** Autocomplete response → suggestions inside the service area. */
export function parseAutocomplete(body: unknown): PlaceSuggestion[] {
  const places = isObj(body) && Array.isArray(body.places) ? body.places : [];
  const out: PlaceSuggestion[] = [];
  for (const p of places) {
    if (!isObj(p)) continue;
    const point = servicePoint(p.latitude, p.longitude);
    const address = str(p.address);
    if (!point || !address) continue;
    out.push({ ...point, address, addressBn: str(p.address_bn), area: str(p.area), city: str(p.city) });
  }
  return out;
}

export function parseReverse(body: unknown): ReverseGeocodeResult | null {
  const place = isObj(body) && isObj(body.place) ? body.place : null;
  if (!place) return null;
  const result = { address: str(place.address), area: str(place.area), city: str(place.city) };
  return result.address || result.area || result.city ? result : null;
}

// ── HTTP ─────────────────────────────────────────────────────

/** JSON from Barikoi, or null on any failure. Logs the path and status only — never the key. */
async function call(path: string, params: Record<string, string>, init: RequestInit = {}): Promise<unknown> {
  const key = barikoiApiKey();
  if (!key) return null;
  const url = `${BASE_URL}${path}?${new URLSearchParams({ api_key: key, ...params })}`;
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[barikoi] ${path} → HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[barikoi] ${path} failed: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

/** Address → point (Rupantor). Null when not configured, not found, unsure or outside Bangladesh. */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const q = address.trim().slice(0, 300);
  if (q.length < 3) return null;
  const body = await call("/v2/api/search/rupantor/geocode", {}, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q, district: "yes", thana: "yes" }).toString(),
  });
  return parseGeocode(body);
}

/** Address search suggestions for the pin picker. */
export async function autocomplete(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim().slice(0, 120);
  if (q.length < 2) return [];
  return parseAutocomplete(await call("/v2/api/search/autocomplete/place", { q, bangla: "true" }));
}

/** Point → nearest address. */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  if (!servicePoint(lat, lng)) return null;
  return parseReverse(
    await call("/v2/api/search/reverse/geocode", { latitude: String(lat), longitude: String(lng), district: "true" })
  );
}
