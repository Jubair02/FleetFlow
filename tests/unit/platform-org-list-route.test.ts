import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/platform/organizations with a mocked Prisma client.
const db = vi.hoisted(() => ({
  plan: { findUnique: vi.fn() },
  organization: { count: vi.fn(), findMany: vi.fn() },
  user: { count: vi.fn(), groupBy: vi.fn() },
  vehicle: { groupBy: vi.fn() },
  delivery: { groupBy: vi.fn() },
  auditLog: { groupBy: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform-auth", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-auth")>()), requirePlatformAdmin: guard }));

import { GET } from "@/app/api/platform/organizations/route";
import { ApiError } from "@/lib/api-helpers";

const get = (qs = "") => GET(new Request(`http://localhost/api/platform/organizations${qs ? `?${qs}` : ""}`));

const ORG = {
  id: "org1", name: "Meghna Foods", status: "ACTIVE", plan: "growth", subscriptionStatus: "TRIAL", paidUntil: null,
  createdAt: new Date("2026-01-15T00:00:00Z"), billingCycle: "MONTHLY", subscriptionPriceBdt: null, contactEmail: "ops@meghna.test",
  planRecord: { name: "Growth", active: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ id: "pa1", name: "Root", mustChangePassword: false });
  db.plan.findUnique.mockResolvedValue({ code: "growth" });
  db.organization.count.mockResolvedValue(3);
  db.user.count.mockResolvedValue(9);
  db.organization.findMany.mockResolvedValue([ORG]);
  db.user.groupBy.mockResolvedValue([
    { organizationId: "org1", role: "ADMIN", active: true, _count: { _all: 2 } },
    { organizationId: "org1", role: "ADMIN", active: false, _count: { _all: 1 } },
    { organizationId: "org1", role: "DRIVER", active: true, _count: { _all: 4 } },
  ]);
  db.vehicle.groupBy.mockResolvedValue([{ organizationId: "org1", _count: { _all: 3 } }]);
  // all, this month, last 30d, previous 30d
  db.delivery.groupBy
    .mockResolvedValueOnce([{ organizationId: "org1", _count: { _all: 50 }, _max: { createdAt: new Date("2026-10-01T00:00:00Z") } }])
    .mockResolvedValueOnce([{ organizationId: "org1", _count: { _all: 6 } }])
    .mockResolvedValueOnce([{ organizationId: "org1", _count: { _all: 12 } }])
    .mockResolvedValueOnce([{ organizationId: "org1", _count: { _all: 10 } }]);
  db.auditLog.groupBy.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/platform/organizations", () => {
  it("is guarded first", async () => {
    guard.mockRejectedValueOnce(new ApiError(401, "Platform authentication required"));
    expect((await get()).status).toBe(401);
    expect(db.organization.findMany).not.toHaveBeenCalled();
  });

  it("returns the old fields plus users, deliveries30d/prev, contactEmail, planActive and a summary", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 3, page: 1, pageSize: 20, pageCount: 1 });
    expect(body.items[0]).toMatchObject({
      id: "org1", planName: "Growth", planActive: false, contactEmail: "ops@meghna.test",
      counts: { admins: 2, drivers: 4, vehicles: 3, deliveries: 50, deliveriesThisMonth: 6 },
      users: 7, deliveries30d: 12, deliveriesPrev30d: 10,
    });
    expect(Object.keys(body.summary).sort()).toEqual(
      ["activeOrganizations", "activeSubscriptions", "newActiveThisWeek", "newOrganizationsThisWeek", "newUsersThisWeek", "totalOrganizations", "totalUsers"].sort()
    );
    // Per-metric groupBy over the page's ids — never per organization.
    expect(db.delivery.groupBy).toHaveBeenCalledTimes(4);
    expect(db.delivery.groupBy.mock.calls[0][0].where.organizationId).toEqual({ in: ["org1"] });
  });

  it("applies pageSize, subscription, plan, registered range and email search", async () => {
    await get("pageSize=10&page=2&subscription=TRIAL&plan=growth&from=2026-01-01&to=2026-01-31&search=meghna");
    const args = db.organization.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 10, take: 10 });
    expect(args.where).toMatchObject({
      subscriptionStatus: "TRIAL",
      plan: "growth",
      createdAt: { gte: new Date("2026-01-01T00:00:00Z"), lt: new Date("2026-02-01T00:00:00Z") },
    });
    expect(JSON.stringify(args.where.OR)).toContain("contactEmail");
    expect(JSON.stringify(args.where.OR)).toContain("users");
    expect(args.select.passwordHash).toBeUndefined();
  });

  it("export=1 returns every match (capped) on one page, without the summary", async () => {
    const res = await get("export=1&page=4&pageSize=10");
    const body = await res.json();
    expect(db.organization.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 5000 });
    expect(body.summary).toBeNull();
    expect(body.page).toBe(1);
  });

  it("rejects invalid filters with 400", async () => {
    expect((await get("from=2026-02-01&to=2026-01-01")).status).toBe(400);
    expect((await get("pageSize=7")).status).toBe(400);
    expect((await get("subscription=NOPE")).status).toBe(400);
  });
});
