import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";

// Plan management: input validation, price-snapshot rules, the limit-impact
// confirmation (409) and server-side feature gating — Prisma is mocked.
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  plan: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  organization: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  user: { count: vi.fn() },
  vehicle: { count: vi.fn() },
  delivery: { count: vi.fn() },
  auditLog: { create: vi.fn(), createMany: vi.fn() },
  platformAuditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform-auth", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-auth")>()), requirePlatformAdmin: guard }));
const requireAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), requireAdmin }));

import { ApiError } from "@/lib/api-helpers";
import { assertFeature, toPlanDefinition } from "@/lib/plans";
import {
  assertCanDeactivate, assertCanMakeDefault, assertImpactConfirmed, checkSetPlan, planCreateSchema, planDiff, planFieldsSchema,
  resolveSnapshotPrice, summarizePlans, tightenedResources, PlanImpactError,
} from "@/lib/platform-service";
import { PATCH as patchPlan } from "@/app/api/platform/plans/[code]/route";
import { PATCH as patchOrg } from "@/app/api/platform/organizations/[id]/route";
import { POST as importDeliveries } from "@/app/api/deliveries/import/route";
import { GET as importTemplate } from "@/app/api/deliveries/import/template/route";
import { GET as reports } from "@/app/api/reports/route";

const row = (over: Partial<Plan> = {}): Plan => ({
  code: "growth", name: "Growth", description: "For distributors", monthlyPriceBdt: 4000, annualPriceBdt: 40000,
  maxDrivers: 20, maxVehicles: 20, maxAdmins: 3, maxMonthlyDeliveries: 3000,
  features: ["csv_import", "report_export", "customer_emails"], highlights: ["Everything in Starter"],
  active: true, isPublic: true, isDefault: false, sortOrder: 2,
  createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"), ...over,
});
const TRIAL = row({ code: "trial", name: "Trial", monthlyPriceBdt: null, annualPriceBdt: null, isDefault: true, isPublic: false, sortOrder: 0 });
const STARTER = row({ code: "starter", name: "Starter", monthlyPriceBdt: 1500, annualPriceBdt: 15000, maxDrivers: 5, features: ["customer_emails"] });

const input = (over: Record<string, unknown> = {}) => ({
  code: "pro-2026", name: "Pro", description: "", monthlyPriceBdt: 6000, annualPriceBdt: null,
  limits: { drivers: 30, vehicles: 30, admins: null, monthlyDeliveries: 6000 },
  features: ["report_export", "csv_import", "csv_import"], highlights: ["Fast"], isPublic: true, sortOrder: 4, ...over,
});

function statusOf(fn: () => unknown): number | "ok" {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}

const json = (body: unknown, method = "PATCH") =>
  new Request("http://localhost/api/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const codeParams = (code: string) => ({ params: Promise.resolve({ code }) });

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ id: "pa1", name: "Root", mustChangePassword: false });
  requireAdmin.mockResolvedValue({ id: "u1", name: "Owner", role: "ADMIN", organizationId: "org1" });
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => unknown) => fn(db));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("plan input validation", () => {
  it("accepts a valid plan; normalizes code, empty description and features", () => {
    const p = planCreateSchema.parse(input({ code: " Pro-2026 " }));
    expect(p.code).toBe("pro-2026");
    expect(p.description).toBeNull();
    expect(p.features).toEqual(["csv_import", "report_export"]);
  });
  it("code: 2–32 chars of a-z, 0-9 and '-'", () => {
    for (const code of ["a", "x".repeat(33), "pro plan", "pro_plan", "pró"]) {
      expect(planCreateSchema.safeParse(input({ code })).success, code).toBe(false);
    }
    expect(planCreateSchema.safeParse(input({ code: "b2" })).success).toBe(true);
  });
  it("rejects bad names, prices, limits, features and highlights", () => {
    const bad: Record<string, unknown>[] = [
      { name: "P" }, { name: "x".repeat(61) }, { description: "x".repeat(301) },
      { monthlyPriceBdt: -1 }, { monthlyPriceBdt: 10.5 }, { annualPriceBdt: "100" },
      { limits: { drivers: -1, vehicles: 1, admins: 1, monthlyDeliveries: 1 } },
      { limits: { drivers: 1.5, vehicles: 1, admins: 1, monthlyDeliveries: 1 } },
      { limits: { drivers: 1, vehicles: 1, admins: 1 } },
      { features: ["sms"] }, { highlights: Array(9).fill("x") }, { highlights: ["x".repeat(81)] },
      { isPublic: "yes" }, { sortOrder: 1.5 },
    ];
    for (const over of bad) expect(planFieldsSchema.safeParse(input(over)).success, JSON.stringify(over)).toBe(false);
  });
  it("null prices and limits are allowed (not sold / unlimited)", () => {
    const ok = planFieldsSchema.safeParse(input({ monthlyPriceBdt: null, limits: { drivers: null, vehicles: null, admins: null, monthlyDeliveries: 0 } }));
    expect(ok.success).toBe(true);
  });
});

describe("set-plan snapshot rules", () => {
  const org = { plan: "trial", billingCycle: "MONTHLY", subscriptionPriceBdt: null };
  const growth = toPlanDefinition(row());

  it("snapshot = explicit price, else the list price for the cycle", () => {
    expect(resolveSnapshotPrice(growth, "MONTHLY")).toBe(4000);
    expect(resolveSnapshotPrice(growth, "ANNUAL")).toBe(40000);
    expect(resolveSnapshotPrice(growth, "MONTHLY", 3500)).toBe(3500);
    expect(resolveSnapshotPrice(growth, "MONTHLY", 0)).toBe(0);
    expect(resolveSnapshotPrice(growth, "MONTHLY", null)).toBe(4000);
  });
  it("a plan free on both cycles snapshots null; a paid plan missing the cycle's price needs an explicit price (400)", () => {
    expect(resolveSnapshotPrice(toPlanDefinition(TRIAL), "ANNUAL")).toBeNull();
    const monthlyOnly = toPlanDefinition(row({ annualPriceBdt: null }));
    expect(statusOf(() => resolveSnapshotPrice(monthlyOnly, "ANNUAL"))).toBe(400);
    expect(resolveSnapshotPrice(monthlyOnly, "ANNUAL", 45000)).toBe(45000);
  });
  it("target must exist and be active, except staying on the current (inactive) plan", () => {
    expect(statusOf(() => checkSetPlan(org, null, "MONTHLY"))).toBe(400);
    const retired = toPlanDefinition(row({ active: false }));
    expect(statusOf(() => checkSetPlan(org, retired, "MONTHLY"))).toBe(409);
    const onRetired = { plan: "growth", billingCycle: "MONTHLY", subscriptionPriceBdt: 3000 };
    expect(checkSetPlan(onRetired, retired, "ANNUAL")).toEqual({ snapshot: 40000 });
    expect(checkSetPlan(onRetired, retired, "MONTHLY", 3200)).toEqual({ snapshot: 3200 });
  });
  it("refuses a no-op (same plan, cycle and price)", () => {
    const on = { plan: "growth", billingCycle: "MONTHLY", subscriptionPriceBdt: 4000 };
    expect(statusOf(() => checkSetPlan(on, growth, "MONTHLY"))).toBe(409);
    expect(statusOf(() => checkSetPlan(on, growth, "MONTHLY", 4000))).toBe(409);
    // grandfathered at 3000 → re-snapshot to the list price is a change
    expect(checkSetPlan({ ...on, subscriptionPriceBdt: 3000 }, growth, "MONTHLY")).toEqual({ snapshot: 4000 });
  });
});

describe("limit impact & plan guards", () => {
  const before = { drivers: 20, vehicles: 20, admins: 3, monthlyDeliveries: 3000 };
  const over = [{ organizationId: "o1", organizationName: "Acme", over: [{ resource: "drivers" as const, usage: 12, limit: 10 }] }];

  it("tightened resources: lower, or unlimited → number", () => {
    expect(tightenedResources({ ...before, admins: null }, { ...before, drivers: 10, admins: 5, vehicles: 25 })).toEqual(["drivers", "admins"]);
    expect(tightenedResources(before, { ...before, drivers: null })).toEqual([]);
  });
  it("409 with the impact unless confirmed; unchanged limits never block", () => {
    const next = { ...before, drivers: 10 };
    let err: unknown;
    try {
      assertImpactConfirmed(before, next, over, false);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PlanImpactError);
    expect((err as PlanImpactError).status).toBe(409);
    expect((err as PlanImpactError).impact).toEqual(over);
    expect(() => assertImpactConfirmed(before, next, over, true)).not.toThrow();
    expect(() => assertImpactConfirmed(before, next, [], false)).not.toThrow();
    // an org already over the (unchanged) driver limit doesn't block raising vehicles
    expect(() => assertImpactConfirmed(before, { ...before, vehicles: 30 }, over, false)).not.toThrow();
  });
  it("default plan can't be deactivated; make-default needs an active, non-default plan", () => {
    expect(statusOf(() => assertCanDeactivate({ active: true, isDefault: true }))).toBe(409);
    expect(statusOf(() => assertCanDeactivate({ active: false, isDefault: false }))).toBe(409);
    expect(statusOf(() => assertCanDeactivate({ active: true, isDefault: false }))).toBe("ok");
    expect(statusOf(() => assertCanMakeDefault({ active: false, isDefault: false }))).toBe(409);
    expect(statusOf(() => assertCanMakeDefault({ active: true, isDefault: true }))).toBe(409);
    expect(statusOf(() => assertCanMakeDefault({ active: true, isDefault: false }))).toBe("ok");
  });
  it("grandfathered = snapshot differs from the list price for the subscriber's cycle", () => {
    const data = summarizePlans([toPlanDefinition(row()), toPlanDefinition(TRIAL)], [
      { plan: "growth", billingCycle: "MONTHLY", subscriptionPriceBdt: 4000, count: 3 },
      { plan: "growth", billingCycle: "MONTHLY", subscriptionPriceBdt: 3000, count: 2 },
      { plan: "growth", billingCycle: "ANNUAL", subscriptionPriceBdt: 40000, count: 1 },
      { plan: "trial", billingCycle: "MONTHLY", subscriptionPriceBdt: null, count: 7 },
    ]);
    expect(data.plans.map((p) => [p.code, p.organizationCount, p.grandfatheredCount])).toEqual([["growth", 6, 2], ["trial", 7, 0]]);
  });
  it("planDiff lists only changed fields", () => {
    const fields = planFieldsSchema.parse({ ...input(), name: "Growth", description: "For distributors", monthlyPriceBdt: 4500, annualPriceBdt: 40000,
      limits: { drivers: 20, vehicles: 20, admins: 3, monthlyDeliveries: 3000 }, features: ["customer_emails", "csv_import", "report_export"],
      highlights: ["Everything in Starter"], sortOrder: 2 });
    expect(planDiff(toPlanDefinition(row()), fields)).toEqual({ monthlyPriceBdt: { from: 4000, to: 4500 } });
  });
});

describe("PATCH /api/platform/plans/[code]", () => {
  const fields = (limits: Record<string, number | null>) => ({ ...input(), name: "Growth", limits });
  beforeEach(() => {
    db.plan.findUnique.mockResolvedValue(row());
    db.plan.findUniqueOrThrow.mockResolvedValue(row());
    db.plan.update.mockImplementation(async ({ data }: { data: Partial<Plan> }) => ({ ...row(), ...data }));
    db.$queryRaw.mockResolvedValue([{ code: "growth" }]);
    db.organization.findMany.mockResolvedValue([{ id: "o1", name: "Acme", timezone: "Asia/Dhaka" }]);
    // getUsage: drivers, vehicles, admins (user.count twice), monthly deliveries
    db.user.count.mockImplementation(async ({ where }: { where: { role: string } }) => (where.role === "DRIVER" ? 12 : 1));
    db.vehicle.count.mockResolvedValue(2);
    db.delivery.count.mockResolvedValue(10);
  });

  it("is guarded", async () => {
    guard.mockRejectedValueOnce(new ApiError(401, "Platform authentication required"));
    expect((await patchPlan(json({ action: "activate" }), codeParams("growth"))).status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("update that puts subscribers over a stricter limit → 409 { error, impact } and nothing saved", async () => {
    const res = await patchPlan(json({ action: "update", plan: fields({ drivers: 10, vehicles: 20, admins: 3, monthlyDeliveries: 3000 }) }), codeParams("growth"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/over the new limits/);
    expect(body.impact).toEqual([{ organizationId: "o1", organizationName: "Acme", over: [{ resource: "drivers", usage: 12, limit: 10 }] }]);
    expect(db.plan.update).not.toHaveBeenCalled();
    expect(db.platformAuditLog.create).not.toHaveBeenCalled();
  });

  it("confirmed update saves live limits and audits the diff; subscriber prices untouched", async () => {
    const plan = fields({ drivers: 10, vehicles: 20, admins: 3, monthlyDeliveries: 3000 });
    const res = await patchPlan(json({ action: "update", plan, confirmImpact: true }), codeParams("growth"));
    expect(res.status).toBe(200);
    expect(db.plan.update.mock.calls[0][0]).toMatchObject({ where: { code: "growth" }, data: { maxDrivers: 10, monthlyPriceBdt: 6000 } });
    expect(db.organization.updateMany).not.toHaveBeenCalled();
    const audit = db.platformAuditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: "PLAN_UPDATED", targetType: "Plan", targetId: "growth", actorId: "pa1" });
    const detail = JSON.parse(audit.detail);
    expect(detail.changes["limits.drivers"]).toEqual({ from: 20, to: 10 });
    expect(detail.impactConfirmed).toBe(true);
  });

  it("deactivating the default plan → 409", async () => {
    db.plan.findUniqueOrThrow.mockResolvedValue(TRIAL);
    expect((await patchPlan(json({ action: "deactivate" }), codeParams("trial"))).status).toBe(409);
    expect(db.plan.update).not.toHaveBeenCalled();
  });

  it("make-default unsets the old default before setting the new one", async () => {
    db.plan.findFirst.mockResolvedValue({ code: "trial" });
    const res = await patchPlan(json({ action: "make-default" }), codeParams("growth"));
    expect(res.status).toBe(200);
    expect(db.plan.updateMany).toHaveBeenCalledWith({ where: { isDefault: true }, data: { isDefault: false } });
    expect(db.plan.updateMany.mock.invocationCallOrder[0]).toBeLessThan(db.plan.update.mock.invocationCallOrder[0]);
    expect(JSON.parse(db.platformAuditLog.create.mock.calls[0][0].data.detail)).toEqual({ from: "trial", to: "growth" });
  });

  it("apply-price re-snapshots only stale subscribers on that cycle, with tenant + platform audit", async () => {
    db.$queryRaw
      .mockResolvedValueOnce([{ code: "growth" }])
      .mockResolvedValueOnce([{ id: "o1", subscriptionPriceBdt: 3000 }, { id: "o2", subscriptionPriceBdt: 4000 }, { id: "o3", subscriptionPriceBdt: null }]);
    db.organization.updateMany.mockResolvedValue({ count: 2 });
    const res = await patchPlan(json({ action: "apply-price-to-subscribers", billingCycle: "MONTHLY" }), codeParams("growth"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ updated: 2 });
    expect(db.organization.updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ["o1", "o3"] }, plan: "growth", billingCycle: "MONTHLY" },
      data: { subscriptionPriceBdt: 4000 },
    });
    const tenant = db.auditLog.createMany.mock.calls[0][0].data;
    expect(tenant.map((r: { organizationId: string }) => r.organizationId)).toEqual(["o1", "o3"]);
    expect(tenant[0]).toMatchObject({ action: "PLAN_PRICE_UPDATED", actorName: "FleetFlow support" });
    expect(JSON.parse(tenant[0].detail).note).toBe("Plan price updated by FleetFlow support");
    expect(db.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: "PLAN_PRICE_APPLIED", targetType: "Plan" });
  });

  it("apply-price on a cycle the plan doesn't sell → 400", async () => {
    db.plan.findUniqueOrThrow.mockResolvedValue(row({ annualPriceBdt: null }));
    expect((await patchPlan(json({ action: "apply-price-to-subscribers", billingCycle: "ANNUAL" }), codeParams("growth"))).status).toBe(400);
    expect(db.organization.updateMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/platform/organizations/[id] set-plan", () => {
  const params = { params: Promise.resolve({ id: "org1" }) };
  beforeEach(() => {
    db.$queryRaw.mockResolvedValue([{ id: "org1" }]);
    db.organization.findUniqueOrThrow.mockResolvedValue({ id: "org1", status: "ACTIVE", plan: "trial", billingCycle: "MONTHLY", subscriptionPriceBdt: null });
  });

  it("assigns an active plan with the list-price snapshot and audits from/to", async () => {
    db.plan.findUnique.mockResolvedValue(STARTER);
    const res = await patchOrg(json({ action: "set-plan", plan: "starter", billingCycle: "ANNUAL" }), params);
    expect(res.status).toBe(200);
    const data = db.organization.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ plan: "starter", billingCycle: "ANNUAL", subscriptionPriceBdt: 15000 });
    expect(data.planAssignedAt).toBeInstanceOf(Date);
    const detail = JSON.parse(db.platformAuditLog.create.mock.calls[0][0].data.detail);
    expect(detail).toMatchObject({ from: { plan: "trial", priceBdt: null }, to: { plan: "starter", billingCycle: "ANNUAL", priceBdt: 15000 } });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "PLAN_CHANGED", actorName: "FleetFlow support" });
  });

  it("an inactive or unknown plan can't be assigned", async () => {
    db.plan.findUnique.mockResolvedValueOnce({ ...STARTER, active: false }).mockResolvedValueOnce(null);
    expect((await patchOrg(json({ action: "set-plan", plan: "starter", billingCycle: "MONTHLY" }), params)).status).toBe(409);
    expect((await patchOrg(json({ action: "set-plan", plan: "gold", billingCycle: "MONTHLY" }), params)).status).toBe(400);
    expect(db.organization.update).not.toHaveBeenCalled();
  });
});

describe("feature gating (server-side)", () => {
  const onPlan = (features: string[]) => db.organization.findUnique.mockResolvedValue({ planRecord: row({ name: "Starter", features }) });

  it("assertFeature: 403 with an upgrade message when the plan lacks the feature", async () => {
    onPlan(["customer_emails"]);
    await expect(assertFeature(db as never, "org1", "csv_import")).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/CSV delivery import.*Starter.*upgrade/) });
    onPlan(["csv_import"]);
    await expect(assertFeature(db as never, "org1", "csv_import")).resolves.toBeUndefined();
  });

  it("CSV import (preview and commit) and the template need csv_import", async () => {
    onPlan(["customer_emails"]);
    for (const mode of ["preview", "commit"]) {
      const res = await importDeliveries(json({ fileName: "a.csv", csv: "x", mode }, "POST"));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/upgrade/i);
    }
    expect((await importTemplate()).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
    onPlan(["csv_import"]);
    expect((await importTemplate()).status).toBe(200);
  });

  it("report CSV export needs report_export (viewing reports doesn't call the gate)", async () => {
    onPlan(["customer_emails"]);
    const res = await reports(new Request("http://localhost/api/reports?export=1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Report CSV export/);
  });
});
