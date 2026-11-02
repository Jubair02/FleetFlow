import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";

// /api/routes and /api/routes/optimize — plan gate, validation, saving routeSeq/plannedEta. Prisma is mocked (no DB).
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  organization: { findUnique: vi.fn() },
  user: { findFirst: vi.fn() },
  driverLocation: { findUnique: vi.fn() },
  delivery: { findMany: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const requireStaff = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), requireStaff }));

import { GET, PUT } from "@/app/api/routes/route";
import { POST as optimize } from "@/app/api/routes/optimize/route";

const plan = (features: string[]): Plan => ({
  code: "growth", name: "Growth", description: "", monthlyPriceBdt: 4000, annualPriceBdt: 40000,
  maxDrivers: 20, maxVehicles: 20, maxAdmins: 3, maxMonthlyDeliveries: 3000,
  features, highlights: [], active: true, isPublic: true, isDefault: false, sortOrder: 2,
  createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"),
});

const stop = (id: string, lat: number | null, lng: number | null, over: Record<string, unknown> = {}) => ({
  id, trackingCode: `FF-${id}`, recipientName: "Rahim", deliveryAddress: `House ${id}, Dhaka`, status: "ASSIGNED", priority: "NORMAL",
  expectedAt: null, deliveryLat: lat, deliveryLng: lng, routeSeq: null, routePlannedAt: null, plannedEta: null, ...over,
});

const STOPS = [stop("far", 23.9, 90.41), stop("near", 23.785, 90.41), stop("noloc", null, null)];

const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue({ id: "u1", name: "Dispatch", role: "DISPATCHER", organizationId: "org1" });
  db.organization.findUnique.mockResolvedValue({ planRecord: plan(["live_map"]), pickupLat: 23.7808, pickupLng: 90.4093 });
  db.user.findFirst.mockResolvedValue({ id: "drv1", name: "Karim" });
  db.driverLocation.findUnique.mockResolvedValue(null);
  db.delivery.findMany.mockResolvedValue(STOPS);
  db.delivery.update.mockResolvedValue({});
  db.$queryRaw.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => unknown) => fn(db));
});

describe("GET /api/routes", () => {
  it("needs a driver", async () => {
    const res = await GET(new Request("http://localhost/api/routes"));
    expect(res.status).toBe(400);
  });

  it("is refused without the live_map feature", async () => {
    db.organization.findUnique.mockResolvedValue({ planRecord: plan([]), pickupLat: null, pickupLng: null });
    const res = await GET(new Request("http://localhost/api/routes?driverId=drv1"));
    expect(res.status).toBe(403);
  });

  it("returns stops from the depot with totals and the unlocated count", async () => {
    const res = await GET(new Request("http://localhost/api/routes?driverId=drv1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.start).toMatchObject({ source: "DEPOT", lat: 23.7808 });
    expect(body.stops.map((s: { id: string }) => s.id)).toEqual(["far", "near", "noloc"]);
    expect(body.unlocatedCount).toBe(1);
    expect(body.totals.km).toBeGreaterThan(0);
    expect(db.delivery.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: "org1", assignments: { some: { active: true, driverId: "drv1" } } });
  });

  it("starts from a fresh driver location", async () => {
    db.driverLocation.findUnique.mockResolvedValue({ organizationId: "org1", lat: 23.8, lng: 90.42, recordedAt: new Date() });
    const body = await (await GET(new Request("http://localhost/api/routes?driverId=drv1"))).json();
    expect(body.start.source).toBe("DRIVER");
  });

  it("ignores a stale driver location", async () => {
    db.driverLocation.findUnique.mockResolvedValue({ organizationId: "org1", lat: 23.8, lng: 90.42, recordedAt: new Date(Date.now() - 60 * 60_000) });
    const body = await (await GET(new Request("http://localhost/api/routes?driverId=drv1"))).json();
    expect(body.start.source).toBe("DEPOT");
  });

  it("404s for a driver outside the organization", async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/routes?driverId=other"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/routes/optimize", () => {
  it("saves the optimised order with estimates and audits it", async () => {
    const res = await optimize(new Request("http://localhost/api/routes/optimize", json("POST", { driverId: "drv1" })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stops.map((s: { id: string }) => s.id)).toEqual(["near", "far", "noloc"]);
    const updates = db.delivery.update.mock.calls.map((c) => [c[0].where.id, c[0].data.routeSeq, c[0].data.plannedEta]);
    expect(updates.map((u) => u.slice(0, 2))).toEqual([["near", 1], ["far", 2], ["noloc", 3]]);
    expect(updates[0][2]).toBeInstanceOf(Date);
    expect(updates[2][2]).toBeNull();
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "ROUTE_OPTIMIZED", entityType: "User", entityId: "drv1" });
  });

  it("refuses when the stops changed between read and lock", async () => {
    db.delivery.findMany.mockResolvedValueOnce(STOPS).mockResolvedValueOnce(STOPS.slice(0, 2));
    const res = await optimize(new Request("http://localhost/api/routes/optimize", json("POST", { driverId: "drv1" })));
    expect(res.status).toBe(409);
    expect(db.delivery.update).not.toHaveBeenCalled();
  });

  it("has nothing to plan for a driver without stops", async () => {
    db.delivery.findMany.mockResolvedValue([]);
    const res = await optimize(new Request("http://localhost/api/routes/optimize", json("POST", { driverId: "drv1" })));
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/routes", () => {
  it("saves a manual order", async () => {
    const res = await PUT(new Request("http://localhost/api/routes", json("PUT", { driverId: "drv1", order: ["noloc", "far", "near"] })));
    expect(res.status).toBe(200);
    expect(db.delivery.update.mock.calls.map((c) => [c[0].where.id, c[0].data.routeSeq])).toEqual([["noloc", 1], ["far", 2], ["near", 3]]);
    expect(db.auditLog.create.mock.calls[0][0].data.action).toBe("ROUTE_REORDERED");
  });

  it("must list exactly the driver's open stops", async () => {
    const missing = await PUT(new Request("http://localhost/api/routes", json("PUT", { driverId: "drv1", order: ["far", "near"] })));
    expect(missing.status).toBe(409);
    const foreign = await PUT(new Request("http://localhost/api/routes", json("PUT", { driverId: "drv1", order: ["far", "near", "elsewhere"] })));
    expect(foreign.status).toBe(409);
    const dupes = await PUT(new Request("http://localhost/api/routes", json("PUT", { driverId: "drv1", order: ["far", "far", "near"] })));
    expect(dupes.status).toBe(400);
    expect(db.delivery.update).not.toHaveBeenCalled();
  });
});
