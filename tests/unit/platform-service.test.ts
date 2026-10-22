import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { ApiError } from "@/lib/api-helpers";
import {
  REACTIVATION_DATA, USER_ROW_SELECT, assertCanReactivate, assertCanSuspend, auditListQuery, checkDeactivate,
  createOrgSchema, createOrgSchemaFor, lastDayKeys, lastMonthKeys, orgActionSchema, orgListQuery, orgSessionsWhere, paged, parseQuery,
  platformPasswordSchema, resourceForRole, supportAuditData, suspensionData, userActionSchema, userListQuery,
} from "@/lib/platform-service";

function statusOf(fn: () => unknown): number | "ok" {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}

const base = { role: "ADMIN", active: true, activeJobs: 0, otherActiveAdmins: 1, orgStatus: "ACTIVE" };

describe("deactivate guard", () => {
  it("refuses the last active admin of an ACTIVE organization (409)", () => {
    expect(statusOf(() => checkDeactivate({ ...base, otherActiveAdmins: 0 }))).toBe(409);
  });
  it("allows it when another admin is active, or when the org is suspended", () => {
    expect(checkDeactivate(base)).toBe(true);
    expect(checkDeactivate({ ...base, otherActiveAdmins: 0, orgStatus: "SUSPENDED" })).toBe(true);
  });
  it("refuses a driver with active assignments (409)", () => {
    expect(statusOf(() => checkDeactivate({ ...base, role: "DRIVER", activeJobs: 2, otherActiveAdmins: 0 }))).toBe(409);
    expect(checkDeactivate({ ...base, role: "DRIVER", activeJobs: 0, otherActiveAdmins: 0 })).toBe(true);
  });
  it("is a no-op for an already inactive user", () => {
    expect(checkDeactivate({ ...base, active: false, otherActiveAdmins: 0 })).toBe(false);
  });
  it("activation counts against the right plan resource", () => {
    expect(resourceForRole("DRIVER")).toBe("drivers");
    expect(resourceForRole("ADMIN")).toBe("admins");
  });
});

describe("organization actions", () => {
  it("suspend refuses an already suspended org; reactivate refuses an active one", () => {
    expect(statusOf(() => assertCanSuspend({ status: "SUSPENDED" }))).toBe(409);
    expect(statusOf(() => assertCanSuspend({ status: "ACTIVE" }))).toBe("ok");
    expect(statusOf(() => assertCanReactivate({ status: "ACTIVE" }))).toBe(409);
    expect(statusOf(() => assertCanReactivate({ status: "SUSPENDED" }))).toBe("ok");
  });
  it("suspension only sets status fields, and session revocation is scoped to that organization", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(suspensionData("Unpaid", now)).toEqual({ status: "SUSPENDED", suspendedAt: now, suspendedReason: "Unpaid" });
    expect(REACTIVATION_DATA).toEqual({ status: "ACTIVE", suspendedAt: null, suspendedReason: null });
    expect(orgSessionsWhere("org1")).toEqual({ user: { organizationId: "org1" } });
  });
  it("validates action payloads", () => {
    expect(orgActionSchema.safeParse({ action: "suspend", reason: "no" }).success).toBe(false);
    expect(orgActionSchema.safeParse({ action: "suspend", reason: "x".repeat(301) }).success).toBe(false);
    expect(orgActionSchema.safeParse({ action: "suspend", reason: "Unpaid invoice" }).success).toBe(true);
    // set-plan: plan existence/activeness is checked against the DB in the route (checkSetPlan)
    expect(orgActionSchema.safeParse({ action: "set-plan", plan: "business" }).success).toBe(false); // cycle required
    expect(orgActionSchema.safeParse({ action: "set-plan", plan: "business", billingCycle: "WEEKLY" }).success).toBe(false);
    expect(orgActionSchema.safeParse({ action: "set-plan", plan: "business", billingCycle: "ANNUAL" }).success).toBe(true);
    expect(orgActionSchema.safeParse({ action: "set-plan", plan: "Business", billingCycle: "MONTHLY", priceBdt: 3500 }).data)
      .toMatchObject({ plan: "business", priceBdt: 3500 });
    expect(orgActionSchema.safeParse({ action: "set-plan", plan: "business", billingCycle: "MONTHLY", priceBdt: null }).success).toBe(true);
    expect(orgActionSchema.safeParse({ action: "set-plan", plan: "business", billingCycle: "MONTHLY", priceBdt: -1 }).success).toBe(false);
    expect(orgActionSchema.safeParse({ action: "set-plan", plan: "business", billingCycle: "MONTHLY", priceBdt: 99.5 }).success).toBe(false);
    expect(orgActionSchema.safeParse({ action: "set-plan", plan: "business", billingCycle: "MONTHLY", priceBdt: "4000" }).success).toBe(false);
    expect(orgActionSchema.safeParse({ action: "delete" }).success).toBe(false);
    const sub = { action: "update-subscription", subscriptionStatus: "ACTIVE", billingNotes: null };
    expect(orgActionSchema.safeParse({ ...sub, paidUntil: "2026-12-31" }).success).toBe(true);
    expect(orgActionSchema.safeParse({ ...sub, paidUntil: "2026-12-31T00:00:00.000Z" }).success).toBe(true);
    expect(orgActionSchema.safeParse({ ...sub, paidUntil: null }).success).toBe(true);
    expect(orgActionSchema.safeParse({ ...sub, paidUntil: "next week" }).success).toBe(false);
    expect(orgActionSchema.safeParse({ ...sub, subscriptionStatus: "FREE", paidUntil: null }).success).toBe(false);
    expect(orgActionSchema.safeParse({ ...sub, paidUntil: null, billingNotes: "x".repeat(1001) }).success).toBe(false);
  });
  it("tenant audit rows written by support carry no actor id", () => {
    const row = supportAuditData({ organizationId: "o1", action: "PLAN_CHANGED", entityType: "Organization", entityId: "o1", detail: { from: "trial", to: "growth" } });
    expect(row).toMatchObject({ organizationId: "o1", actorId: null, actorName: "FleetFlow support" });
  });
});

describe("input schemas", () => {
  it("create org: normalizes email, requires an active plan code", () => {
    const ok = createOrgSchema.parse({ companyName: " Acme ", adminName: "Rina", adminEmail: " Rina@Acme.COM ", plan: "Starter" });
    expect(ok).toMatchObject({ companyName: "Acme", adminEmail: "rina@acme.com", plan: "starter" });
    expect(createOrgSchema.safeParse({ companyName: "A", adminName: "Rina", adminEmail: "r@a.co", plan: "starter" }).success).toBe(false);
    const active = createOrgSchemaFor(["trial", "starter", "growth"]);
    expect(active.safeParse({ companyName: "Acme", adminName: "Rina", adminEmail: "r@a.co", plan: "growth" }).success).toBe(true);
    const bad = active.safeParse({ companyName: "Acme", adminName: "Rina", adminEmail: "r@a.co", plan: "business" }); // inactive / unknown
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/active plan/);
  });
  it("platform password: ≥12 chars and different from current", () => {
    expect(platformPasswordSchema.safeParse({ currentPassword: "a", newPassword: "short" }).success).toBe(false);
    expect(platformPasswordSchema.safeParse({ currentPassword: "same-password-12", newPassword: "same-password-12" }).success).toBe(false);
    expect(platformPasswordSchema.safeParse({ currentPassword: "old", newPassword: "a-long-new-password" }).success).toBe(true);
  });
  it("user actions: no role change or admin creation exists", () => {
    expect(userActionSchema.safeParse({ action: "reset-password" }).success).toBe(true);
    expect(userActionSchema.safeParse({ action: "make-admin" }).success).toBe(false);
    expect(userActionSchema.safeParse({ action: "set-role", role: "ADMIN" }).success).toBe(false);
  });
  it("list queries: empty/'all' mean no filter, bad values are 400", () => {
    const p = (q: string) => new URLSearchParams(q);
    expect(parseQuery(orgListQuery, p("status=all&search=&page="), ["search", "status", "plan", "page"])).toEqual({ page: 1 });
    expect(parseQuery(userListQuery, p("role=DRIVER&status=inactive&page=3"), ["search", "role", "status", "organizationId", "page"]))
      .toMatchObject({ role: "DRIVER", status: "inactive", page: 3 });
    expect(statusOf(() => parseQuery(orgListQuery, p("status=DELETED"), ["status", "page"]))).toBe(400);
    expect(statusOf(() => parseQuery(userListQuery, p("page=0"), ["page"]))).toBe(400);
    expect(statusOf(() => parseQuery(auditListQuery, p("page=abc"), ["page"]))).toBe(400);
  });
  it("user row select never includes the password hash", () => {
    expect(Object.keys(USER_ROW_SELECT)).not.toContain("passwordHash");
  });
});

describe("aggregation helpers", () => {
  it("month/day keys are UTC, oldest first, ending now", () => {
    const now = new Date("2026-02-03T05:00:00Z");
    const months = lastMonthKeys(now, 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-03");
    expect(months.at(-1)).toBe("2026-02");
    const days = lastDayKeys(now, 30);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-01-05");
    expect(days.at(-1)).toBe("2026-02-03");
  });
  it("paged computes pageCount (min 1)", () => {
    expect(paged([], 0, 1, 20)).toEqual({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 1 });
    expect(paged([1], 41, 3, 20).pageCount).toBe(3);
  });
});
