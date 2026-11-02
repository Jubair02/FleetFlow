import type { StyleSpecification } from "maplibre-gl";

// ─────────────────────────────────────────────────────────────
// Map styles and colours — no maplibre runtime here (type import only),
// so screens can use these without pulling the map library into their
// chunk. docs/MAPS.md.
// ─────────────────────────────────────────────────────────────

/** Dhaka — where an empty map opens. */
export const DEFAULT_CENTER = { lat: 23.8103, lng: 90.4125 };
export const DEFAULT_ZOOM = 11;

/**
 * OpenStreetMap raster tiles — used when no Barikoi map key is configured.
 * Fine for development and light use; their tile policy asks for the
 * attribution below and no heavy traffic (set BARIKOI_MAP_KEY in production).
 */
export function osmRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}

/** The style to draw: Barikoi (its dark variant in dark mode) or the OSM fallback. */
export function resolveMapStyle(styleUrl: string | null | undefined, dark: boolean): string | StyleSpecification {
  if (!styleUrl) return osmRasterStyle();
  return dark ? styleUrl.replace("/osm-liberty/", "/barikoi-dark/") : styleUrl;
}

/** Pin colour per delivery status (matches the status badges' hues). */
export const STATUS_PIN_COLORS: Record<string, string> = {
  CREATED: "#64748b",
  ASSIGNED: "#2563eb",
  PICKED_UP: "#7c3aed",
  IN_TRANSIT: "#d97706",
  FAILED: "#dc2626",
  DELIVERED: "#16a34a",
  CANCELLED: "#94a3b8",
};

export const DRIVER_COLOR = "#0f766e";
export const DEPOT_COLOR = "#111827";

/** Distinct colours for drivers' route lines. */
const ROUTE_COLORS = ["#0f766e", "#2563eb", "#c026d3", "#ea580c", "#0891b2", "#4f46e5", "#be123c", "#65a30d"];

export function routeColor(index: number): string {
  return ROUTE_COLORS[((index % ROUTE_COLORS.length) + ROUTE_COLORS.length) % ROUTE_COLORS.length];
}

/** "https://www.google.com/maps?q=lat,lng" — opens the phone's maps app. */
export function externalMapUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
