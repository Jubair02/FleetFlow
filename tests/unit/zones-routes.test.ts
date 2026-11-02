import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// /api/zones/** — Prisma is mocked (no DB).
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  deliveryZone: { findMany: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
  delivery: { groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const auth = vi.hoisted(() => ({ requireAdmin: vi.fn(), requireStaff: vi.fn() }));
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), ...auth }));

import { ApiError } from "@/lib/api-helpers";
import { GET, POST } from "@/app/api/zones/route";
import { PATCH, DELETE } from "@/app/api/zones/[id]/route";
import { POST as preview } from "@/app/api/zones/preview/route";
import { POST as reorder } from "@/app/api/zones/reorder/route";
import { POST as recalculate } from "@/app/api/zones/recalculate/route";
import { POST as starter } from "@/app/api/zones/starter/route";

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const req = (path: string, body?: unknown, method = "POST") =>
  new Request(`http://localhost${path}`, body === undefined ? { method } : { ...json(body), method });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const row = (over: Record<string, unknown> = {}) => ({
  id: "z1", organizationId: "org1", name: "Inside Dhaka", areas: ["Dhanmondi", "Mirpur"], baseFeeBdt: 60, includedKg: 1, perExtraKgBdt: 15,
  codFeePercent: 1, codFeeMinBdt: 0, isDefault: false, sortOrder: 0, active: true, createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  const admin = { id: "u1", name: "Owner", role: "ADMIN", organizationId: "org1" };
  auth.requireAdmin.mockResolvedValue(admin);
  auth.requireStaff.mockResolvedValue(admin);
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => unknown) => fn(db));
  db.$queryRaw.mockResolvedValue([{ id: "org1" }]);
  db.deliveryZone.findMany.mockResolvedValue([row(), row({ id: "z3", name: "Outside Dhaka", areas: [], baseFeeBdt: 120, isDefault: true, sortOrder: 1 })]);
  db.deliveryZone.aggregate.mockResolvedValue({ _count: { _all: 2 }, _max: { sortOrder: 1 } });
  db.deliveryZone.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "znew", ...data }));
  db.delivery.groupBy.mockResolvedValue([{ zoneId: "z1", _count: { _all: 4 } }]);
});

describe("GET /api/zones", () => {
  it("lists the org's zones with open-delivery counts (staff)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((z: { id: string; openDeliveries: number }) => [z.id, z.openDeliveries])).toEqual([["z1", 4], ["z3", 0]]);
    expect(db.deliveryZone.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
  });
});

describe("POST /api/zones", () => {
  it("is admin only", async () => {
    auth.requireAdmin.mockRejectedValueOnce(new ApiError(403, "Admin access required"));
    const res = await POST(req("/api/zones", { name: "Zone", baseFeeBdt: 60 }));
    expect(res.status).toBe(403);
    expect(db.deliveryZone.create).not.toHaveBeenCalled();
  });

  it("validates the body (400 with the first message)", async () => {
    const res = await POST(req("/api/zones", { name: "Zone", baseFeeBdt: "lots" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/base charge/);
  });

  it("creates at the end of the order, clears the old default and audits", async () => {
    const res = await POST(req("/api/zones", { name: "Suburbs", baseFeeBdt: 100, areas: ["Savar"], isDefault: true }));
    expect(res.status).toBe(201);
    expect(db.deliveryZone.updateMany).toHaveBeenCalledWith({ where: { organizationId: "org1", isDefault: true }, data: { isDefault: false } });
    expect(db.deliveryZone.create.mock.calls[0][0].data).toMatchObject({ organizationId: "org1", name: "Suburbs", sortOrder: 2, isDefault: true, areas: ["Savar"] });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "ZONE_CREATED", organizationId: "org1" });
  });

  it("maps a duplicate name to 409", async () => {
    db.deliveryZone.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }));
    const res = await POST(req("/api/zones", { name: "Inside Dhaka", baseFeeBdt: 60 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already exists/);
  });
});

describe("PATCH / DELETE /api/zones/[id]", () => {
  it("404s for another organization's zone", async () => {
    db.deliveryZone.findFirst.mockResolvedValue(null);
    const res = await PATCH(req("/api/zones/zX", { baseFeeBdt: 70 }, "PATCH"), params("zX"));
    expect(res.status).toBe(404);
    expect(db.deliveryZone.findFirst.mock.calls[0][0].where).toEqual({ id: "zX", organizationId: "org1" });
  });

  it("writes and audits only changed fields; a new default clears the others", async () => {
    db.deliveryZone.findFirst.mockResolvedValue(row());
    const res = await PATCH(req("/api/zones/z1", { baseFeeBdt: 70, areas: ["Dhanmondi", "Mirpur"], isDefault: true }, "PATCH"), params("z1"));
    expect(res.status).toBe(200);
    expect(db.deliveryZone.update).toHaveBeenCalledWith({ where: { id: "z1" }, data: { baseFeeBdt: 70, isDefault: true } });
    expect(db.deliveryZone.updateMany.mock.calls[0][0].where).toMatchObject({ organizationId: "org1", isDefault: true, NOT: { id: "z1" } });
    expect(JSON.parse(db.auditLog.create.mock.calls[0][0].data.detail).fields).toEqual(["baseFeeBdt", "isDefault"]);
  });

  it("deletes and audits with the number of linked deliveries", async () => {
    db.deliveryZone.findFirst.mockResolvedValue({ ...row(), _count: { deliveries: 3 } });
    const res = await DELETE(req("/api/zones/z1", undefined, "DELETE"), params("z1"));
    expect(res.status).toBe(200);
    expect(db.deliveryZone.delete).toHaveBeenCalledWith({ where: { id: "z1" } });
    expect(JSON.parse(db.auditLog.create.mock.calls[0][0].data.detail)).toEqual({ name: "Inside Dhaka", deliveries: 3 });
  });
});

describe("POST /api/zones/preview", () => {
  it("returns the matched zone and fee breakdown", async () => {
    const res = await preview(req("/api/zones/preview", { address: "Road 2, Mirpur-10", weightKg: 2.5, codAmount: 1000 }));
    expect(await res.json()).toEqual({
      zone: { id: "z1", name: "Inside Dhaka" },
      kind: "area",
      matchedArea: "Mirpur",
      fee: { baseBdt: 60, extraKg: 2, weightBdt: 30, codBdt: 10, totalBdt: 100 },
      zonesConfigured: true,
    });
  });

  it("falls back to the default zone and rejects an unknown manual zone", async () => {
    expect((await (await preview(req("/api/zones/preview", { address: "Sylhet" }))).json()).zone.name).toBe("Outside Dhaka");
    expect((await preview(req("/api/zones/preview", { address: "Sylhet", zoneId: "nope" }))).status).toBe(400);
    expect((await preview(req("/api/zones/preview", { address: "Sylhet", weightKg: -1 }))).status).toBe(400);
  });
});

describe("POST /api/zones/reorder", () => {
  it("requires every zone exactly once", async () => {
    db.deliveryZone.findMany.mockResolvedValue([{ id: "z1", sortOrder: 0 }, { id: "z3", sortOrder: 1 }]);
    expect((await reorder(req("/api/zones/reorder", { ids: ["z3"] }))).status).toBe(409);
    expect((await reorder(req("/api/zones/reorder", { ids: ["z3", "z3"] }))).status).toBe(409);
    const ok = await reorder(req("/api/zones/reorder", { ids: ["z3", "z1"] }));
    expect(ok.status).toBe(200);
    expect(db.deliveryZone.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "z3" }, data: { sortOrder: 0 } },
      { where: { id: "z1" }, data: { sortOrder: 1 } },
    ]);
  });
});

describe("POST /api/zones/starter", () => {
  it("adds only missing starter zones and keeps an existing default", async () => {
    db.deliveryZone.findMany.mockResolvedValue([{ name: "inside dhaka", isDefault: true, sortOrder: 4 }]);
    const res = await starter();
    expect(res.status).toBe(201);
    expect((await res.json()).created).toEqual(["Dhaka suburbs", "Outside Dhaka"]);
    const created = db.deliveryZone.create.mock.calls.map((c) => c[0].data);
    expect(created.map((d: { sortOrder: number; isDefault: boolean }) => [d.sortOrder, d.isDefault])).toEqual([[5, false], [6, false]]);
  });
});

describe("POST /api/zones/recalculate", () => {
  it("re-prices open, non-overridden deliveries in groups and pages with a cursor", async () => {
    db.delivery.findMany.mockResolvedValue([
      { id: "d1", status: "CREATED", deliveryAddress: "Dhanmondi", weightKg: null, codAmount: null, zoneId: "z1", deliveryFeeBdt: 50, feeOverridden: false },
      { id: "d2", status: "ASSIGNED", deliveryAddress: "Mirpur", weightKg: null, codAmount: null, zoneId: "z1", deliveryFeeBdt: 50, feeOverridden: false },
      { id: "d3", status: "CREATED", deliveryAddress: "Mirpur", weightKg: null, codAmount: null, zoneId: "z1", deliveryFeeBdt: 60, feeOverridden: false },
    ]);
    db.delivery.updateMany.mockResolvedValue({ count: 2 });
    const res = await recalculate(req("/api/zones/recalculate", {}));
    expect(await res.json()).toEqual({ checked: 3, updated: 2, nextCursor: null });
    expect(db.delivery.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: "org1", feeOverridden: false });
    expect(db.delivery.updateMany).toHaveBeenCalledTimes(1);
    expect(db.delivery.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["d1", "d2"] }, organizationId: "org1" }, data: { zoneId: "z1", deliveryFeeBdt: 60 } });
  });
});
