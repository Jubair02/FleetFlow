import { describe, expect, it } from "vitest";
import { DEFAULT_SPEED_KMH, STOP_SERVICE_MINUTES, roadKm, travelMinutes } from "@/lib/geo";
import { computeEtas, optimizeRoute, routeKm, type RouteStopInput } from "@/lib/route-optimizer";

// Route planning: stop ordering (nearest neighbour + 2-opt, priority tiers) and arrival estimates.

const DEPOT = { lat: 23.7808, lng: 90.4093 }; // Dhaka

/** Deterministic pseudo-random generator (mulberry32) so tests are repeatable. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomStops(n: number, seed: number, priority = "NORMAL"): RouteStopInput[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `s${String(i).padStart(3, "0")}`,
    lat: 23.7 + r() * 0.2,
    lng: 90.35 + r() * 0.15,
    priority,
  }));
}

const byIds = (stops: RouteStopInput[], ids: string[]) => ids.map((id) => stops.find((s) => s.id === id)!);

describe("optimizeRoute", () => {
  it("handles 0, 1 and 2 stops", () => {
    expect(optimizeRoute(DEPOT, [])).toEqual([]);
    expect(optimizeRoute(null, [])).toEqual([]);
    expect(optimizeRoute(DEPOT, [{ id: "a", lat: 23.8, lng: 90.4, priority: "NORMAL" }])).toEqual(["a"]);
    const two: RouteStopInput[] = [
      { id: "far", lat: 23.9, lng: 90.45, priority: "NORMAL" },
      { id: "near", lat: 23.782, lng: 90.41, priority: "NORMAL" },
    ];
    expect(optimizeRoute(DEPOT, two)).toEqual(["near", "far"]);
  });

  it("visits points along a line in order", () => {
    const stops = [3, 1, 4, 2, 5].map((k) => ({ id: `k${k}`, lat: DEPOT.lat + k * 0.01, lng: DEPOT.lng, priority: "NORMAL" }));
    expect(optimizeRoute(DEPOT, stops)).toEqual(["k1", "k2", "k3", "k4", "k5"]);
  });

  it("returns every stop exactly once", () => {
    const stops = randomStops(60, 7);
    const order = optimizeRoute(DEPOT, stops);
    expect(order).toHaveLength(60);
    expect(new Set(order)).toEqual(new Set(stops.map((s) => s.id)));
  });

  it("2-opt never makes the route longer than nearest neighbour", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const stops = randomStops(5 + seed * 3, seed);
      const nn = routeKm(DEPOT, byIds(stops, optimizeRoute(DEPOT, stops, { improve: false })));
      const opt = routeKm(DEPOT, byIds(stops, optimizeRoute(DEPOT, stops)));
      expect(opt).toBeLessThanOrEqual(nn + 1e-9);
    }
  });

  it("2-opt removes a crossing nearest neighbour leaves behind", () => {
    // NN from the depot zig-zags across this ladder; the optimised route must be shorter.
    const stops = randomStops(40, 99);
    const nn = routeKm(DEPOT, byIds(stops, optimizeRoute(DEPOT, stops, { improve: false })));
    const opt = routeKm(DEPOT, byIds(stops, optimizeRoute(DEPOT, stops)));
    expect(opt).toBeLessThan(nn);
  });

  it("is deterministic and independent of input order", () => {
    const stops = randomStops(30, 3);
    const a = optimizeRoute(DEPOT, stops);
    const b = optimizeRoute(DEPOT, [...stops].reverse());
    const c = optimizeRoute(DEPOT, [...stops].sort((x, y) => x.lng! - y.lng!));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("puts URGENT/HIGH stops before NORMAL/LOW ones", () => {
    const stops: RouteStopInput[] = [
      { id: "near-normal", lat: 23.781, lng: 90.41, priority: "NORMAL" },
      { id: "near-low", lat: 23.7815, lng: 90.4105, priority: "LOW" },
      { id: "far-urgent", lat: 23.87, lng: 90.4, priority: "URGENT" },
      { id: "mid-high", lat: 23.83, lng: 90.4, priority: "HIGH" },
    ];
    const order = optimizeRoute(DEPOT, stops);
    expect(order.slice(0, 2).sort()).toEqual(["far-urgent", "mid-high"]);
    expect(order.slice(2).sort()).toEqual(["near-low", "near-normal"]);
    // inside the priority tier it's still by distance
    expect(order[0]).toBe("mid-high");
  });

  it("keeps priority tiers separate even after 2-opt on many stops", () => {
    const stops = [...randomStops(30, 11, "NORMAL"), ...randomStops(15, 12, "URGENT").map((s) => ({ ...s, id: `u${s.id}` }))];
    const order = optimizeRoute(DEPOT, stops);
    const firstNormal = order.findIndex((id) => !id.startsWith("u"));
    expect(order.slice(0, firstNormal).every((id) => id.startsWith("u"))).toBe(true);
    expect(order.slice(firstNormal).some((id) => id.startsWith("u"))).toBe(false);
  });

  it("keeps fixed stops first in their current order", () => {
    const stops: RouteStopInput[] = [
      { id: "fixed-b", lat: 23.9, lng: 90.45, priority: "LOW", fixedFirst: true, seq: 2 },
      { id: "fixed-a", lat: 23.95, lng: 90.45, priority: "LOW", fixedFirst: true, seq: 1 },
      { id: "x", lat: 23.781, lng: 90.41, priority: "URGENT" },
      { id: "y", lat: 23.9, lng: 90.451, priority: "NORMAL" },
    ];
    const order = optimizeRoute(DEPOT, stops);
    expect(order.slice(0, 2)).toEqual(["fixed-a", "fixed-b"]);
    expect(order[2]).toBe("x");
  });

  it("sends stops without coordinates to the end in seq, then expected-time order", () => {
    const stops: RouteStopInput[] = [
      { id: "nocoord-late", lat: null, lng: null, priority: "URGENT", expectedAt: "2026-10-29T12:00:00Z" },
      { id: "located", lat: 23.79, lng: 90.41, priority: "LOW" },
      { id: "nocoord-early", lat: null, lng: undefined, priority: "NORMAL", expectedAt: "2026-10-29T09:00:00Z" },
      { id: "nocoord-seq", lat: null, lng: null, priority: "NORMAL", seq: 4 },
    ];
    expect(optimizeRoute(DEPOT, stops)).toEqual(["located", "nocoord-seq", "nocoord-early", "nocoord-late"]);
  });

  it("starts from the first located stop when there is no start point", () => {
    const stops: RouteStopInput[] = [
      { id: "b", lat: 23.8, lng: 90.4, priority: "NORMAL", seq: 2 },
      { id: "a", lat: 23.9, lng: 90.4, priority: "NORMAL", seq: 1 },
      { id: "c", lat: 23.91, lng: 90.4, priority: "NORMAL", seq: 3 },
    ];
    expect(optimizeRoute(null, stops)).toEqual(["a", "c", "b"]);
  });

  it("orders 150 stops quickly", () => {
    const stops = randomStops(150, 42);
    const t0 = performance.now();
    const order = optimizeRoute(DEPOT, stops);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(order).toHaveLength(150);
  });
});

describe("computeEtas", () => {
  const depart = new Date("2026-10-29T04:00:00Z");

  it("adds travel time and service time stop by stop", () => {
    const a = { id: "a", lat: 23.79, lng: 90.41 };
    const b = { id: "b", lat: 23.8, lng: 90.43 };
    const res = computeEtas(DEPOT, [a, b], depart);
    const m1 = travelMinutes(DEPOT, a);
    const m2 = m1 + STOP_SERVICE_MINUTES + travelMinutes(a, b);
    expect(res.stops[0].eta!.getTime()).toBe(depart.getTime() + Math.round(m1 * 60_000));
    expect(res.stops[1].eta!.getTime()).toBe(depart.getTime() + Math.round(m2 * 60_000));
    expect(res.totalKm).toBeCloseTo(roadKm(DEPOT, a) + roadKm(a, b), 9);
    expect(res.totalMinutes).toBeCloseTo(m2 + STOP_SERVICE_MINUTES, 9);
    expect(res.stops[0].legKm).toBeCloseTo(roadKm(DEPOT, a), 9);
  });

  it("gives null for stops without coordinates and skips them", () => {
    const a = { id: "a", lat: 23.79, lng: 90.41 };
    const res = computeEtas(DEPOT, [{ id: "x", lat: null, lng: null }, a], depart);
    expect(res.stops[0]).toEqual({ id: "x", eta: null, legKm: null });
    expect(res.stops[1].eta!.getTime()).toBe(depart.getTime() + Math.round(travelMinutes(DEPOT, a) * 60_000));
  });

  it("uses the first located stop as the start when there is none", () => {
    const res = computeEtas(null, [{ id: "a", lat: 23.79, lng: 90.41 }], depart);
    expect(res.stops[0].eta!.getTime()).toBe(depart.getTime());
    expect(res.totalKm).toBe(0);
  });

  it("respects the speed and falls back to the default for a bad one", () => {
    const a = { id: "a", lat: 23.9, lng: 90.41 };
    const slow = computeEtas(DEPOT, [a], depart, 9).stops[0].eta!.getTime();
    const normal = computeEtas(DEPOT, [a], depart).stops[0].eta!.getTime();
    const bad = computeEtas(DEPOT, [a], depart, 0).stops[0].eta!.getTime();
    expect(slow - depart.getTime()).toBeCloseTo(2 * (normal - depart.getTime()), -3);
    expect(bad).toBe(normal);
    expect(DEFAULT_SPEED_KMH).toBeGreaterThan(0);
  });

  it("handles an empty route", () => {
    expect(computeEtas(DEPOT, [], depart)).toEqual({ stops: [], totalKm: 0, totalMinutes: 0 });
  });
});
