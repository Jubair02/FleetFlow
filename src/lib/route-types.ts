// ─────────────────────────────────────────────────────────────
// Route planning API shapes (/api/routes) — client-safe.
// ─────────────────────────────────────────────────────────────

/** Where the route is measured from: the driver's fresh GPS, the company depot, or its first located stop. */
export type RouteStartSource = "DRIVER" | "DEPOT" | "FIRST_STOP";

export interface RouteStart {
  lat: number;
  lng: number;
  source: RouteStartSource;
  /** When the driver's position was recorded (source DRIVER only). */
  recordedAt: string | null;
}

export interface RouteStop {
  id: string;
  trackingCode: string;
  recipientName: string;
  deliveryAddress: string;
  status: string;
  priority: string;
  expectedAt: string | null;
  lat: number | null;
  lng: number | null;
  /** Position in the saved route (1 = first); null = not planned yet. */
  routeSeq: number | null;
  /** Saved arrival estimate; null when not planned or the stop has no map location. */
  plannedEta: string | null;
  /** Road km from the previous located point, in the order shown (estimate). */
  legKm: number | null;
}

/** GET /api/routes?driverId=, and the answer to POST /api/routes/optimize and PUT /api/routes. */
export interface RoutePlan {
  driver: { id: string; name: string };
  start: RouteStart | null;
  /** Open stops in route order (unplanned ones last). */
  stops: RouteStop[];
  /** Estimated road km and minutes (driving + time at each stop) for the order shown. */
  totals: { km: number; minutes: number };
  /** When the saved order was last planned; null if never. */
  plannedAt: string | null;
  /** Stops with no map location (they can't be placed or timed). */
  unlocatedCount: number;
}
