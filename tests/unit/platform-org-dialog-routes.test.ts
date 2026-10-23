import { beforeEach, describe, expect, it, vi } from "vitest";

// Organization dialog endpoints with a mocked Prisma client:
//  - GET   /api/platform/organizations/[id]             (additive stats / defaultPickupAddress)
//  - PATCH /api/platform/organizations/[id] update-profile
//  - GET   /api/platform/organizations/[id]/deliveries
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  session: { deleteMany: vi.fn() },
  auditLog: { create: vi.fn() },
  platformAuditLog: { create: vi.fn() },
}));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  organization: { findUnique: vi.fn() },
  user: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
  vehicle: { count: vi.fn() },
  delivery: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  auditLog: { findMany: vi.fn() },
  platformAuditLog: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform-auth", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-auth")>()), requirePlatformAdmin: guard }));

import { GET as getOrg, PATCH as patchOrg } from "@/app/api/platform/organizations/[id]/route";
import { GET as getDeliveries } from "@/app/api/platform/organizations/[id]/deliveries/route";
import { ApiError } from "@/lib/api-helpers";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) =>
  new Request("http://localhost/api/platform/organizations/org1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const deliveries = (qs = "") => getDeliveries(new Request(`http://localhost/api/platform/organizations/org1/deliveries${qs ? `?${qs}` : ""}`), params("org1"));

const ORG = {
  id: "org1",
  name: "Meghna Foods",
  status: "ACTIVE",
  suspendedAt: null,
  suspendedReason: null,
  plan: "growth",
  subscriptionStatus: "ACTIVE",
  paidUntil: null,
  billingNotes: null,
  billingCycle: "MONTHLY",
  subscriptionPriceBdt: 1500,
  planAssignedAt: new Date("2026-01-01T00:00:00Z"),
  phone: null,
  contactEmail: "ops@meghna.test",
  address: "Dhaka",
  defaultPickupAddress: null,
  timezone: "Asia/Dhaka",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const PLAN_ROW = {
  code: "growth", name: "Growth", description: null, monthlyPriceBdt: 1500, annualPriceBdt: 15000, maxDrivers: 10, maxVehicles: 10, maxAdmins: 3,
  maxMonthlyDeliveries: 1000, features: [], highlights: [], isPublic: true, active: true, isDefault: false, sortOrder: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ id: "pa1", name: "Root", mustChangePassword: false });
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.$queryRaw.mockResolvedValue([{ id: "org1" }]);
  tx.organization.findUniqueOrThrow.mockResolvedValue(ORG);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH update-profile", () => {
  it("is guarded first", async () => {
    guard.mockRejectedValueOnce(new ApiError(401, "Platform authentication required"));
    expect((await patchOrg(patch({ action: "update-profile", name: "New name" }), params("org1"))).status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("writes only changed fields of that org, with both audit rows listing field names only", async () => {
    const res = await patchOrg(
      patch({ action: "update-profile", name: "Meghna Foods Ltd", contactEmail: "ops@meghna.test", address: "", phone: "01711000000", timezone: "Asia/Dhaka" }),
      params("org1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, changed: ["name", "phone", "address"] });
    expect(tx.organization.update).toHaveBeenCalledTimes(1);
    expect(tx.organization.update.mock.calls[0][0]).toEqual({ where: { id: "org1" }, data: { name: "Meghna Foods Ltd", phone: "01711000000", address: null } });

    const platform = tx.platformAuditLog.create.mock.calls[0][0].data;
    expect(platform).toMatchObject({ action: "ORG_PROFILE_UPDATED", organizationId: "org1", targetId: "org1", actorId: "pa1" });
    const tenant = tx.auditLog.create.mock.calls[0][0].data;
    expect(tenant).toMatchObject({ organizationId: "org1", actorName: "FleetFlow support", actorId: null, entityType: "Organization" });
    expect(JSON.parse(tenant.detail)).toEqual({ note: "Company details updated by FleetFlow support", changed: ["name", "phone", "address"] });
    // Values never reach the audit trail.
    expect(tenant.detail).not.toContain("01711000000");
    expect(platform.detail).not.toContain("Meghna Foods Ltd");
  });

  it("no differences → success with no writes and no audit rows", async () => {
    const res = await patchOrg(patch({ action: "update-profile", name: "Meghna Foods", address: "Dhaka" }), params("org1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, changed: [] });
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
  });

  it("rejects invalid input with 400 before touching the database", async () => {
    for (const body of [{ name: "M" }, { timezone: "Mars/Base" }, { contactEmail: "nope" }, { phone: "12" }]) {
      expect((await patchOrg(patch({ action: "update-profile", ...body }), params("org1"))).status).toBe(400);
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("unknown organization → 404", async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await patchOrg(patch({ action: "update-profile", name: "Whatever" }), params("nope"))).status).toBe(404);
    expect(tx.organization.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/platform/organizations/[id] (additive fields)", () => {
  beforeEach(() => {
    db.organization.findUnique.mockResolvedValue({ ...ORG, planRecord: PLAN_ROW });
    db.user.count.mockResolvedValue(0);
    db.vehicle.count.mockResolvedValue(2);
    db.delivery.count.mockResolvedValue(5);
    db.user.findMany.mockResolvedValue([]);
    db.auditLog.findMany.mockResolvedValue([]);
    db.platformAuditLog.findMany.mockResolvedValue([]);
    db.user.groupBy.mockResolvedValue([
      { role: "ADMIN", _count: { _all: 2 } },
      { role: "DRIVER", _count: { _all: 5 } },
    ]);
  });

  it("adds stats with a server-side success rate and defaultPickupAddress", async () => {
    db.delivery.groupBy.mockResolvedValue([
      { status: "DELIVERED", _count: { _all: 9 } },
      { status: "FAILED", _count: { _all: 1 } },
      { status: "IN_TRANSIT", _count: { _all: 4 } },
    ]);
    const res = await getOrg(new Request("http://localhost/api/platform/organizations/org1"), params("org1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organization.defaultPickupAddress).toBeNull();
    expect(body.stats).toEqual({ users: { admins: 2, drivers: 5, total: 7 }, deliveries30d: 14, delivered30d: 9, failed30d: 1, successRate30d: 90 });
    // Org-scoped aggregates only.
    expect(db.user.groupBy.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
    expect(db.delivery.groupBy.mock.calls[0][0].where.organizationId).toBe("org1");
  });

  it("success rate is null when nothing finished", async () => {
    db.delivery.groupBy.mockResolvedValue([{ status: "CREATED", _count: { _all: 3 } }]);
    const body = await (await getOrg(new Request("http://localhost/x"), params("org1"))).json();
    expect(body.stats).toMatchObject({ deliveries30d: 3, delivered30d: 0, failed30d: 0, successRate30d: null });
  });
});

describe("GET /api/platform/organizations/[id]/deliveries", () => {
  beforeEach(() => {
    db.organization.findUnique.mockResolvedValue({ id: "org1" });
    db.delivery.count.mockResolvedValue(23);
    db.delivery.findMany.mockResolvedValue([
      {
        id: "d1",
        trackingCode: "FF-1",
        recipientName: "Nusrat",
        status: "DELIVERED",
        createdAt: new Date("2026-10-01T00:00:00Z"),
        expectedAt: new Date("2026-10-02T00:00:00Z"),
        assignments: [{ driver: { name: "Karim" } }],
      },
    ]);
  });

  it("is guarded first", async () => {
    guard.mockRejectedValueOnce(new ApiError(401, "Platform authentication required"));
    expect((await deliveries()).status).toBe(401);
    expect(db.delivery.findMany).not.toHaveBeenCalled();
  });

  it("returns a page of this org's deliveries with an explicit, safe select", async () => {
    const res = await deliveries("page=2");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 23, page: 2, pageSize: 10, pageCount: 3 });
    expect(body.items[0]).toEqual({
      id: "d1",
      trackingCode: "FF-1",
      recipientName: "Nusrat",
      status: "DELIVERED",
      driverName: "Karim",
      createdAt: "2026-10-01T00:00:00.000Z",
      expectedAt: "2026-10-02T00:00:00.000Z",
    });
    const args = db.delivery.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ organizationId: "org1" });
    expect(db.delivery.count.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
    expect(args).toMatchObject({ skip: 10, take: 10 });
    for (const k of ["trackingToken", "recipientPhone", "recipientEmail"]) expect(args.select[k]).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/trackingToken|recipientPhone|recipientEmail/);
  });

  it("unknown organization → 404; bad paging → 400", async () => {
    db.organization.findUnique.mockResolvedValueOnce(null);
    expect((await deliveries()).status).toBe(404);
    expect((await deliveries("pageSize=500")).status).toBe(400);
    expect((await deliveries("page=0")).status).toBe(400);
  });
});
