import { z } from "zod";
import type { PlatformAdmin, Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { auditData } from "@/lib/notify";
import { PLANS, getPlan, type PlanCode, type PlanResource } from "@/lib/plan-catalog";
import type { Paged, PlatformAdminInfo, PlatformAuditRow, PlatformUserRow, OrgStatus } from "@/lib/platform-types";

// ─────────────────────────────────────────────────────────────
// Shared server logic for /api/platform/* (super admin console).
// Pure helpers live here so the guard rules are unit-testable
// without a database; see tests/unit/platform-*.test.ts.
// ─────────────────────────────────────────────────────────────

export const ORG_PAGE_SIZE = 20;
export const USER_PAGE_SIZE = 25;
export const AUDIT_PAGE_SIZE = 30;

/** Shown as the actor on tenant AuditLog rows written by platform admins. */
export const SUPPORT_ACTOR_NAME = "FleetFlow support";

export const ORG_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export const SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"] as const;
export const PLAN_CODES = Object.keys(PLANS) as [PlanCode, ...PlanCode[]];

// ── Validation ───────────────────────────────────────────────

const email = z.string().trim().toLowerCase().email("Enter a valid email").max(254);

export const platformLoginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(200),
});

export const platformPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(200),
    newPassword: z.string().min(12, "Password must be at least 12 characters").max(200, "Password must be 200 characters or fewer"),
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "The new password must be different from the current one",
    path: ["newPassword"],
  });

export const createOrgSchema = z.object({
  companyName: z.string().trim().min(2, "Company name must be at least 2 characters").max(120, "Company name must be 120 characters or fewer"),
  adminName: z.string().trim().min(2, "Admin name must be at least 2 characters").max(120, "Admin name must be 120 characters or fewer"),
  adminEmail: email,
  plan: z.enum(PLAN_CODES, "Choose a plan from the catalog"),
  phone: z.string().trim().min(6, "Phone must be at least 6 characters").max(30, "Phone must be 30 characters or fewer").optional().or(z.literal("")).nullable(),
});

/** ISO date ("2026-12-31") or ISO datetime; null clears it. */
const isoDate = z
  .string()
  .trim()
  .max(40)
  .refine((v) => /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v) && !Number.isNaN(new Date(v).getTime()), "Paid-until must be an ISO date");

export const orgActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suspend"),
    reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300, "Reason must be 300 characters or fewer"),
  }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("set-plan"), plan: z.enum(PLAN_CODES, "Choose a plan from the catalog") }),
  z.object({
    action: z.literal("update-subscription"),
    subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES, "Choose a valid subscription status"),
    paidUntil: isoDate.nullable(),
    billingNotes: z.string().trim().max(1000, "Billing notes must be 1000 characters or fewer").nullable(),
  }),
], "Unknown action");
export type ParsedOrgAction = z.infer<typeof orgActionSchema>;

export const userActionSchema = z.object({
  action: z.enum(["deactivate", "activate", "reset-password", "revoke-sessions"], "Unknown action"),
});

/** Query-string values: "", "all" and missing all mean "no filter". */
const filter = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === null || v === "" || v === "all" ? undefined : v), schema.optional());

const page = z.preprocess((v) => (v === null || v === "" ? undefined : v), z.coerce.number().int("Invalid page").min(1, "Invalid page").max(100_000).default(1));
const search = filter(z.string().trim().max(100, "Search must be 100 characters or fewer"));
const id = filter(z.string().trim().min(1).max(64));

export const orgListQuery = z.object({
  search,
  status: filter(z.enum(ORG_STATUSES, "Invalid status")),
  plan: filter(z.string().trim().max(40)),
  page,
});

export const userListQuery = z.object({
  search,
  role: filter(z.enum(["ADMIN", "DRIVER"], "Invalid role")),
  status: filter(z.enum(["active", "inactive"], "Invalid status")),
  organizationId: id,
  page,
});

export const auditListQuery = z.object({
  action: filter(z.string().trim().max(60)),
  organizationId: id,
  page,
});

/** Parse URLSearchParams with a schema (400 on bad input). */
export function parseQuery<T extends z.ZodTypeAny>(schema: T, params: URLSearchParams, keys: string[]): z.infer<T> {
  const raw = Object.fromEntries(keys.map((k) => [k, params.get(k)]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  return parsed.data;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  return parsed.data;
}

// ── Paging & serialization ───────────────────────────────────

export function paged<T>(items: T[], total: number, pageNo: number, pageSize: number): Paged<T> {
  return { items, total, page: pageNo, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toAdminInfo(a: Pick<PlatformAdmin, "id" | "name" | "email" | "mustChangePassword" | "lastLoginAt" | "createdAt">): PlatformAdminInfo {
  return { id: a.id, name: a.name, email: a.email, mustChangePassword: a.mustChangePassword, lastLoginAt: iso(a.lastLoginAt), createdAt: a.createdAt.toISOString() };
}

/** Explicit select for user rows — never includes passwordHash. */
export const USER_ROW_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true, status: true } },
} satisfies Prisma.UserSelect;

type UserRowRecord = Prisma.UserGetPayload<{ select: typeof USER_ROW_SELECT }>;

export function toUserRow(u: UserRowRecord): PlatformUserRow {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "DRIVER" ? "DRIVER" : "ADMIN",
    active: u.active,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
    organization: { id: u.organization.id, name: u.organization.name, status: u.organization.status as OrgStatus },
  };
}

export function toAuditRow(
  r: { id: string; actorName: string | null; action: string; targetType: string; targetId: string | null; organizationId: string | null; detail: string | null; createdAt: Date },
  orgNames: Map<string, string>
): PlatformAuditRow {
  return {
    id: r.id,
    actorName: r.actorName,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    organizationId: r.organizationId,
    organizationName: r.organizationId ? orgNames.get(r.organizationId) ?? null : null,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Tenant AuditLog row so the company can see what FleetFlow support did. */
export function supportAuditData(input: { organizationId: string; action: string; entityType: string; entityId: string; detail?: Record<string, unknown> | null }) {
  return auditData({ ...input, actorId: null, actorName: SUPPORT_ACTOR_NAME });
}

// ── Time buckets (UTC) ───────────────────────────────────────

export function startOfUtcMonth(now: Date, monthsBack = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}

export function startOfUtcDay(now: Date, daysBack = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
}

/** The last `n` UTC month keys ("YYYY-MM"), oldest first, ending with the current month. */
export function lastMonthKeys(now: Date, n = 12): string[] {
  return Array.from({ length: n }, (_, i) => startOfUtcMonth(now, n - 1 - i).toISOString().slice(0, 7));
}

/** The last `n` UTC day keys ("YYYY-MM-DD"), oldest first, ending today. */
export function lastDayKeys(now: Date, n = 30): string[] {
  return Array.from({ length: n }, (_, i) => startOfUtcDay(now, n - 1 - i).toISOString().slice(0, 10));
}

// ── Plans ────────────────────────────────────────────────────

/** Map stored plan codes (any case) onto the catalog; unknown codes are tallied separately. */
export function tallyPlans(rows: { plan: string; count: number }[]): { byCode: Record<PlanCode, number>; unknown: number } {
  const byCode = Object.fromEntries(PLAN_CODES.map((c) => [c, 0])) as Record<PlanCode, number>;
  let unknown = 0;
  for (const r of rows) {
    const code = r.plan.trim().toLowerCase() as PlanCode;
    if (code in byCode) byCode[code] += r.count;
    else unknown += r.count;
  }
  return { byCode, unknown };
}

/** Plan limit resource that an account of this role counts against. */
export function resourceForRole(role: string): PlanResource {
  return role === "DRIVER" ? "drivers" : "admins";
}

export function planLimits(code: string): Record<PlanResource, number | null> {
  return getPlan(code).limits;
}

// ── Guard rules ──────────────────────────────────────────────

export function assertCanSuspend(org: { status: string }): void {
  if (org.status === "SUSPENDED") throw new ApiError(409, "This organization is already suspended");
}

export function assertCanReactivate(org: { status: string }): void {
  if (org.status !== "SUSPENDED") throw new ApiError(409, "This organization is not suspended");
}

export function assertPlanChange(currentPlan: string, nextPlan: string): void {
  if (currentPlan.trim().toLowerCase() === nextPlan) throw new ApiError(409, "The organization is already on this plan");
}

/** Fields written by a suspension. Data is never deleted. */
export function suspensionData(reason: string, now: Date) {
  return { status: "SUSPENDED", suspendedAt: now, suspendedReason: reason };
}

export const REACTIVATION_DATA = { status: "ACTIVE", suspendedAt: null, suspendedReason: null } as const;

/** Every tenant session of one organization (and only that organization). */
export function orgSessionsWhere(organizationId: string): Prisma.SessionWhereInput {
  return { user: { organizationId } };
}

export interface DeactivateCheck {
  role: string;
  active: boolean;
  /** Active assignments currently held (drivers). */
  activeJobs: number;
  /** Other active ADMIN users in the same organization. */
  otherActiveAdmins: number;
  orgStatus: string;
}

/**
 * Returns false when the user is already inactive (no-op). Throws 409 for a
 * driver still holding jobs, or for the last active admin of an ACTIVE org.
 */
export function checkDeactivate(c: DeactivateCheck): boolean {
  if (!c.active) return false;
  if (c.role === "DRIVER" && c.activeJobs > 0) {
    throw new ApiError(409, `Driver has ${c.activeJobs} active job(s) — the company must reassign or complete them first`);
  }
  if (c.role === "ADMIN" && c.orgStatus === "ACTIVE" && c.otherActiveAdmins === 0) {
    throw new ApiError(409, "This is the last active admin of an active organization — it can't be deactivated");
  }
  return true;
}

export function parsePaidUntil(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
