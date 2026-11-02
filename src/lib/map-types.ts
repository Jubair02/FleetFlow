// ─────────────────────────────────────────────────────────────
// Map API shapes — client-safe (docs/MAPS.md).
// ─────────────────────────────────────────────────────────────

/** GET /api/maps/config */
export interface MapConfig {
  /** "barikoi" with a map key; otherwise "osm" (OpenStreetMap raster tiles, styleUrl null). */
  provider: "barikoi" | "osm";
  styleUrl: string | null;
  /** Address search / geocoding available (BARIKOI_API_KEY set). */
  geocoding: boolean;
}

/** GET /api/maps/search?q= */
export interface PlaceResult {
  lat: number;
  lng: number;
  address: string;
  addressBn: string | null;
  area: string | null;
  city: string | null;
}

export interface MapDriver {
  id: string;
  name: string;
  vehicle: string | null;
  lat: number;
  lng: number;
  accuracyM: number | null;
  heading: number | null;
  recordedAt: string;
  /** Active jobs (assigned, picked up or in transit). */
  jobs: number;
}

export interface MapDelivery {
  id: string;
  trackingCode: string;
  recipientName: string;
  deliveryAddress: string;
  status: string;
  priority: string;
  lat: number;
  lng: number;
  driverId: string | null;
  routeSeq: number | null;
}

/** GET /api/map — the live map screen. */
export interface LiveMapData {
  depot: { lat: number; lng: number; address: string | null } | null;
  /** Drivers with a fresh position only. */
  drivers: MapDriver[];
  /** Open deliveries that have a map point. */
  deliveries: MapDelivery[];
  /** Open deliveries without a point yet. */
  missingLocation: number;
  /** Open deliveries in total. */
  openTotal: number;
  /** The list was capped at this many deliveries. */
  capped: boolean;
  geocoding: boolean;
  generatedAt: string;
}

/** GET /api/track/[token]/live — empty object when nothing live is shown. */
export interface TrackingLive {
  driver?: { lat: number; lng: number; recordedAt: string };
  destination?: { lat: number; lng: number } | null;
  etaMinutes?: number | null;
  /** Map style for the page (null = OpenStreetMap raster). */
  styleUrl?: string | null;
}
