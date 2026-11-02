import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";

// Live driver location: pure rules, POST /api/driver/location and the
// customer's GET /api/track/[token]/live — Prisma is mocked.
const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  organization: { findUnique: vi.fn() },
  assignment: { count: vi.fn() },
  driverLocation: { upsert: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
  delivery: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const requireDriver = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), requireDriver }));

import { LIVE_LOCATION_MAX_AGE_MS, STOP_SERVICE_MINUTES, travelMinutes } from "@/lib/geo";
import { clampRecordedAt, clearLocationIfIdle, etaMinutes, isFresh, locationRow } from "@/lib/live-location";
import { POST as postLocation } from "@/app/api/driver/location/route";
import { GET as getLive } from "@/app/api/track/[token]/live/route";

const plan = (features: string[]): { planRecord: Plan } => ({
  planRecord: {
    code: "growth", name: "Growth", description: "", monthlyPriceBdt: 4000, annualPriceBdt: 40000,
    maxDrivers: 20, maxVehicles: 20, maxAdmins: 3, maxMonthlyDeliveries: 3000,
    features, highlights: [], active: true, isPublic: true, isDefault: false, sortOrder: 2,
    createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"),
  },
});

const DHANMONDI = { lat: 23.7465, lng: 90.376 };
const GULSHAN = { lat: 23.7925, lng: 90.4078 };
const BANANI = { lat: 23.794, lng: 90.4043 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // hitRateLimit: first request in the window
  db.$queryRaw.mockResolvedValue([{ count: 1, resetAt: new Date(Date.now() + 15_000) }]);
});

describe("rules", () => {
  it("treats positions older than the max age as stale", () => {
    const now = new Date("2026-10-30T10:00:00Z");
    expect(isFresh(new Date(now.getTime() - LIVE_LOCATION_MAX_AGE_MS), now)).toBe(true);
    expect(isFresh(new Date(now.getTime() - LIVE_LOCATION_MAX_AGE_MS - 1), now)).toBe(false);
  });

  it("clamps device time so a skewed clock can't fake freshness", () => {
    const now = new Date("2026-10-30T10:00:00Z");
    expect(clampRecordedAt("2026-10-30T11:00:00Z", now)).toEqual(now);
    expect(clampRecordedAt("2026-10-29T10:00:00Z", now).getTime()).toBe(now.getTime() - LIVE_LOCATION_MAX_AGE_MS);
    expect(clampRecordedAt(undefined, now)).toEqual(now);
    expect(clampRecordedAt("2026-10-30T09:59:30Z", now)).toEqual(new Date("2026-10-30T09:59:30Z"));
  });

  it("rounds fixes and refuses ones outside the service area", () => {
    const row = locationRow({ lat: 23.746512345, lng: 90.37609, accuracy: 12 });
    expect(row).toMatchObject({ lat: 23.74651, lng: 90.37609, accuracyM: 12, heading: null, speedKmh: null });
    expect(locationRow({ lat: 51.5, lng: -0.12 })).toBeNull();
  });

  it("ETA: direct drive without route order, via earlier stops with it", () => {
    const target = { id: "t", lat: GULSHAN.lat, lng: GULSHAN.lng, routeSeq: 3 };
    expect(etaMinutes(DHANMONDI, { ...target, routeSeq: null }, [])).toBe(Math.round(travelMinutes(DHANMONDI, GULSHAN)));
    const earlier = [
      { id: "a", lat: BANANI.lat, lng: BANANI.lng, routeSeq: 2 },
      { id: "later", lat: 23.9, lng: 90.5, routeSeq: 5 },
      { id: "nopoint", lat: null, lng: null, routeSeq: 1 },
    ];
    const expected = travelMinutes(DHANMONDI, BANANI) + STOP_SERVICE_MINUTES + travelMinutes(BANANI, GULSHAN);
    expect(etaMinutes(DHANMONDI, target, earlier)).toBe(Math.round(expected));
    expect(etaMinutes(DHANMONDI, { ...target, lat: null, lng: null }, [])).toBeNull();
    expect(etaMinutes(GULSHAN, { ...target, routeSeq: null }, [])).toBe(1); // already there: at least a minute
  });

  it("deletes the stored position once nothing is in progress", async () => {
    db.assignment.count.mockResolvedValueOnce(1);
    await clearLocationIfIdle("u1");
    expect(db.driverLocation.deleteMany).not.toHaveBeenCalled();
    db.assignment.count.mockResolvedValueOnce(0);
    await clearLocationIfIdle("u1");
    expect(db.driverLocation.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});

describe("POST /api/driver/location", () => {
  const send = (body: unknown) =>
    postLocation(new Request("http://localhost/api/driver/location", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  beforeEach(() => {
    requireDriver.mockResolvedValue({ id: "u1", organizationId: "org1", role: "DRIVER" });
    db.organization.findUnique.mockResolvedValue(plan(["live_map"]));
    db.assignment.count.mockResolvedValue(1);
  });

  it("stores the latest position (upsert, no history)", async () => {
    const res = await send({ lat: 23.7465, lng: 90.376, accuracy: 8, speedKmh: 20 });
    expect(res.status).toBe(200);
    const args = db.driverLocation.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "u1" });
    expect(args.create).toMatchObject({ userId: "u1", organizationId: "org1", lat: 23.7465, lng: 90.376, accuracyM: 8, speedKmh: 20 });
    // only picked-up / in-transit jobs count
    expect(db.assignment.count.mock.calls[0][0].where.delivery.status.in).toEqual(["PICKED_UP", "IN_TRANSIT"]);
  });

  it("403 without the live_map feature", async () => {
    db.organization.findUnique.mockResolvedValue(plan([]));
    expect((await send({ lat: 23.7, lng: 90.4 })).status).toBe(403);
    expect(db.driverLocation.upsert).not.toHaveBeenCalled();
  });

  it("409 off-shift — and any old position is removed", async () => {
    db.assignment.count.mockResolvedValue(0);
    expect((await send({ lat: 23.7, lng: 90.4 })).status).toBe(409);
    expect(db.driverLocation.upsert).not.toHaveBeenCalled();
    expect(db.driverLocation.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("429 when sent too often, 400 on bad input, 422 outside the service area", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ count: 2, resetAt: new Date(Date.now() + 10_000) }]);
    const limited = await send({ lat: 23.7, lng: 90.4 });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect((await send({ lat: "x", lng: 90.4 })).status).toBe(400);
    expect((await send({ lat: 51.5, lng: -0.12 })).status).toBe(422);
    expect(db.driverLocation.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/track/[token]/live", () => {
  const TOKEN = "a".repeat(32);
  const get = (token = TOKEN) => getLive(new Request(`http://localhost/api/track/${token}/live`), { params: Promise.resolve({ token }) });
  const delivery = (over: Record<string, unknown> = {}) => ({
    id: "d1", organizationId: "org1", trackingEnabled: true, status: "IN_TRANSIT",
    deliveryLat: GULSHAN.lat, deliveryLng: GULSHAN.lng, routeSeq: null,
    assignments: [{ driverId: "u1" }], ...over,
  });

  beforeEach(() => {
    db.delivery.findUnique.mockResolvedValue(delivery());
    db.organization.findUnique.mockResolvedValue(plan(["live_map"]));
    db.driverLocation.findUnique.mockResolvedValue({ ...DHANMONDI, recordedAt: new Date() });
    db.delivery.findMany.mockResolvedValue([]);
  });

  it("shows only position, destination and ETA — nothing about the driver", async () => {
    const body = await (await get()).json();
    expect(Object.keys(body).sort()).toEqual(["destination", "driver", "etaMinutes", "styleUrl"]);
    expect(Object.keys(body.driver).sort()).toEqual(["lat", "lng", "recordedAt"]);
    expect(body.destination).toEqual(GULSHAN);
    expect(body.etaMinutes).toBe(Math.round(travelMinutes(DHANMONDI, GULSHAN)));
  });

  it("answers {} unless every condition holds", async () => {
    const cases: [string, () => void][] = [
      ["tracking off", () => db.delivery.findUnique.mockResolvedValue(delivery({ trackingEnabled: false }))],
      ["only assigned", () => db.delivery.findUnique.mockResolvedValue(delivery({ status: "ASSIGNED" }))],
      ["delivered", () => db.delivery.findUnique.mockResolvedValue(delivery({ status: "DELIVERED" }))],
      ["no driver", () => db.delivery.findUnique.mockResolvedValue(delivery({ assignments: [] }))],
      ["no plan feature", () => db.organization.findUnique.mockResolvedValue(plan([]))],
      ["no position", () => db.driverLocation.findUnique.mockResolvedValue(null)],
      ["stale position", () => db.driverLocation.findUnique.mockResolvedValue({ ...DHANMONDI, recordedAt: new Date(Date.now() - LIVE_LOCATION_MAX_AGE_MS - 60_000) })],
    ];
    for (const [label, arrange] of cases) {
      arrange();
      const res = await get();
      expect(await res.json(), label).toEqual({});
      // restore the happy path for the next case
      db.delivery.findUnique.mockResolvedValue(delivery());
      db.organization.findUnique.mockResolvedValue(plan(["live_map"]));
      db.driverLocation.findUnique.mockResolvedValue({ ...DHANMONDI, recordedAt: new Date() });
    }
  });

  it("404s malformed tokens and rate-limits per link + client", async () => {
    expect((await get("not-a-token")).status).toBe(404);
    db.$queryRaw.mockResolvedValueOnce([{ count: 99, resetAt: new Date(Date.now() + 30_000) }]);
    const res = await get();
    expect(res.status).toBe(429);
    expect(String(db.$queryRaw.mock.calls.at(-1)?.slice(1))).toContain(`track-live:${TOKEN}:`);
  });

  it("counts the driver's earlier route stops in the ETA", async () => {
    db.delivery.findUnique.mockResolvedValue(delivery({ routeSeq: 2 }));
    db.delivery.findMany.mockResolvedValue([{ id: "a", deliveryLat: BANANI.lat, deliveryLng: BANANI.lng, routeSeq: 1 }]);
    const body = await (await get()).json();
    expect(body.etaMinutes).toBe(Math.round(travelMinutes(DHANMONDI, BANANI) + STOP_SERVICE_MINUTES + travelMinutes(BANANI, GULSHAN)));
    expect(db.delivery.findMany.mock.calls[0][0].where).toMatchObject({ routeSeq: { lt: 2 }, assignments: { some: { driverId: "u1", active: true } } });
  });
});
