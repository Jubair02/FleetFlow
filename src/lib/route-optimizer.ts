import { DEFAULT_SPEED_KMH, STOP_SERVICE_MINUTES, roadKm, toLatLng, travelMinutes, type LatLng } from "@/lib/geo";

// ─────────────────────────────────────────────────────────────
// Stop ordering and arrival estimates for one driver's route (docs/ROUTES.md).
// Pure and deterministic: the same stops give the same order whatever order
// they are passed in, so server, client and tests agree.
//
// The heuristic, in order:
//  1. Fixed stops (fixedFirst, e.g. the delivery the driver already set off
//     for) stay at the front, in their current order.
//  2. The other located stops are split into two priority tiers: URGENT/HIGH
//     first, then NORMAL/LOW. Hard tiers rather than a distance discount
//     because the promise to the customer ("urgent goes first") must hold
//     whatever the geography; a discount can always be outweighed by a long
//     enough detour, which is exactly when a dispatcher would be surprised.
//     Only two tiers so the route doesn't zig-zag across town four times.
//  3. Each tier is seeded nearest-neighbour from where the previous one
//     ended, then the whole path is improved with 2-opt on road distance
//     (open path: the start is fixed, the end is free). A 2-opt move may
//     only reverse a segment inside one tier, so tiers never mix, and it is
//     only applied when it shortens the route — 2-opt can never make the
//     route longer than its nearest-neighbour seed.
//  4. Stops without coordinates can't be placed, so they go last in their
//     current order (seq), then by expected time, then id.
//
// Parcels already on board (PICKED_UP/IN_TRANSIT) are just stops: their
// destination is all that matters. ASSIGNED parcels are assumed to be
// collected at the start point (the depot) — pickups are not modelled.
// ─────────────────────────────────────────────────────────────

export interface RouteStopInput {
  id: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  priority: string;
  expectedAt?: Date | string | null;
  /** Keep at the front of the route (in seq order) — e.g. the stop the driver is heading to. */
  fixedFirst?: boolean;
  /** Current position in the route (routeSeq); orders fixed and unlocated stops. */
  seq?: number | null;
}

const PRIORITY_TIER: Record<string, number> = { URGENT: 0, HIGH: 0, NORMAL: 1, LOW: 1 };
const tierOf = (priority: string) => PRIORITY_TIER[priority] ?? 1;

/** Tolerance so floating-point noise can't make 2-opt loop. */
const EPS = 1e-9;
/** Safety cap on 2-opt sweeps; at ~150 stops it converges well before this. */
const MAX_SWEEPS = 200;

const timeOf = (v: Date | string | null | undefined) => {
  if (!v) return Number.POSITIVE_INFINITY;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

/** seq (unsequenced last), then expected time (none last), then id — the "current order". */
function byCurrentOrder(a: RouteStopInput, b: RouteStopInput): number {
  const sa = a.seq ?? Number.POSITIVE_INFINITY;
  const sb = b.seq ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ta = timeOf(a.expectedAt);
  const tb = timeOf(b.expectedAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Deterministic seed order inside a tier: earliest expected time, then id (only breaks exact distance ties). */
function bySeedOrder(a: RouteStopInput, b: RouteStopInput): number {
  const ta = timeOf(a.expectedAt);
  const tb = timeOf(b.expectedAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Road km along a path: start → stops in order (stops without coordinates are skipped). */
export function routeKm(start: LatLng | null, stops: readonly Pick<RouteStopInput, "lat" | "lng">[]): number {
  let km = 0;
  let cursor = start;
  for (const s of stops) {
    const p = toLatLng(s.lat, s.lng);
    if (!p) continue;
    if (cursor) km += roadKm(cursor, p);
    cursor = p;
  }
  return km;
}

interface Located {
  stop: RouteStopInput;
  point: LatLng;
  tier: number;
}

function nearestNeighbour(from: LatLng, pool: Located[]): Located[] {
  const left = [...pool];
  const out: Located[] = [];
  let cursor = from;
  while (left.length) {
    let best = 0;
    let bestKm = roadKm(cursor, left[0].point);
    for (let i = 1; i < left.length; i++) {
      const km = roadKm(cursor, left[i].point);
      if (km < bestKm - EPS) {
        best = i;
        bestKm = km;
      }
    }
    const [next] = left.splice(best, 1);
    out.push(next);
    cursor = next.point;
  }
  return out;
}

/**
 * 2-opt over an open path whose node 0 is the fixed start. Reverses
 * path[i..j] when that shortens the route; i ≥ firstMovable and path[i],
 * path[j] in the same tier (tiers are contiguous, so the whole segment is).
 */
function twoOpt(path: LatLng[], tiers: number[], firstMovable: number): number[] {
  const n = path.length;
  const order = path.map((_, i) => i);
  if (n - firstMovable < 2) return order;
  const dist: number[][] = path.map((a) => path.map((b) => roadKm(a, b)));
  const d = (a: number, b: number) => dist[order[a]][order[b]];

  for (let sweep = 0, improved = true; improved && sweep < MAX_SWEEPS; sweep++) {
    improved = false;
    for (let i = firstMovable; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        if (tiers[order[i]] !== tiers[order[j]]) break; // past the end of i's tier
        const before = d(i - 1, i) + (j + 1 < n ? d(j, j + 1) : 0);
        const after = d(i - 1, j) + (j + 1 < n ? d(i, j + 1) : 0);
        if (after < before - EPS) {
          for (let a = i, b = j; a < b; a++, b--) [order[a], order[b]] = [order[b], order[a]];
          improved = true;
        }
      }
    }
  }
  return order;
}

export interface OptimizeOptions {
  /** Skip the 2-opt pass (nearest-neighbour only) — for tests and comparisons. */
  improve?: boolean;
}

/**
 * Best stop order (ids) for a route starting at `start`. With no start
 * point the first fixed or located stop (in current order) is used.
 */
export function optimizeRoute(start: LatLng | null, stops: readonly RouteStopInput[], opts: OptimizeOptions = {}): string[] {
  // Canonical input order → output doesn't depend on how stops were passed.
  const all = [...stops].sort(byCurrentOrder);
  const fixed = all.filter((s) => s.fixedFirst);
  const rest = all.filter((s) => !s.fixedFirst);
  const located: Located[] = [];
  const unlocated: RouteStopInput[] = [];
  for (const s of rest) {
    const point = toLatLng(s.lat, s.lng);
    if (point) located.push({ stop: s, point, tier: tierOf(s.priority) });
    else unlocated.push(s);
  }

  // Where the movable part of the route begins: after the last located fixed stop.
  let origin = start;
  for (const f of fixed) origin = toLatLng(f.lat, f.lng) ?? origin;
  if (!origin && located.length) {
    // No start and nothing fixed: begin at the first located stop in current order.
    origin = located[0].point;
  }

  let seeded: Located[] = [];
  if (origin) {
    let cursor = origin;
    for (const tier of [0, 1]) {
      const pool = located.filter((l) => l.tier === tier).sort((a, b) => bySeedOrder(a.stop, b.stop));
      const chain = nearestNeighbour(cursor, pool);
      seeded = seeded.concat(chain);
      if (chain.length) cursor = chain[chain.length - 1].point;
    }
  }

  let movable = seeded;
  if (opts.improve !== false && origin && seeded.length > 2) {
    const path = [origin, ...seeded.map((l) => l.point)];
    const tiers = [-1, ...seeded.map((l) => l.tier)];
    const order = twoOpt(path, tiers, 1);
    movable = order.slice(1).map((i) => seeded[i - 1]);
  }

  return [...fixed.map((s) => s.id), ...movable.map((l) => l.stop.id), ...unlocated.map((s) => s.id)];
}

export interface StopEta {
  id: string;
  /** Estimated arrival; null when the stop has no coordinates (or there is no start point). */
  eta: Date | null;
  /** Road km from the previous located point; null when unknown. */
  legKm: number | null;
}

export interface RouteEstimate {
  stops: StopEta[];
  /** Road km from the start to the last located stop. */
  totalKm: number;
  /** Driving + service minutes from departure to leaving the last located stop. */
  totalMinutes: number;
}

/**
 * Arrival estimates along an ordered route: drive at `speedKmh` between
 * located stops (roadKm), plus STOP_SERVICE_MINUTES at each. A stop without
 * coordinates gets null and adds no time — estimates after it may be early.
 * With no start, the first located stop is the start (ETA = departure).
 */
export function computeEtas(
  start: LatLng | null,
  orderedStops: readonly Pick<RouteStopInput, "id" | "lat" | "lng">[],
  departAt: Date,
  speedKmh = DEFAULT_SPEED_KMH
): RouteEstimate {
  const speed = Number.isFinite(speedKmh) && speedKmh > 0 ? speedKmh : DEFAULT_SPEED_KMH;
  let cursor = start;
  let minutes = 0;
  let totalKm = 0;
  let lastDone = 0;
  const out: StopEta[] = [];
  for (const s of orderedStops) {
    const p = toLatLng(s.lat, s.lng);
    if (!p) {
      out.push({ id: s.id, eta: null, legKm: null });
      continue;
    }
    const legKm = cursor ? roadKm(cursor, p) : 0;
    minutes += cursor ? travelMinutes(cursor, p, speed) : 0;
    totalKm += legKm;
    out.push({ id: s.id, eta: new Date(departAt.getTime() + Math.round(minutes * 60_000)), legKm });
    minutes += STOP_SERVICE_MINUTES;
    lastDone = minutes;
    cursor = p;
  }
  return { stops: out, totalKm, totalMinutes: lastDone };
}
