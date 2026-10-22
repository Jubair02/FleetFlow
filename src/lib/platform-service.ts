import { z } from "zod";
import type { PlatformAdmin, Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { auditData } from "@/lib/notify";
import { platformAuditData } from "@/lib/platform-auth";
import {
  FEATURE_KEYS, PLAN_RESOURCES, listPrice,
  type BillingCycle, type FeatureKey, type PlanDefinition, type PlanResource,
} from "@/lib/plan-catalog";
import type { LimitImpactRow, Paged, PlatformAdminInfo, PlatformAuditRow, PlatformPlansData, PlatformUserRow, OrgStatus } from "@/lib/platform-types";

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

/** Upper bounds that keep typos (an extra zero or three) out of plan data. */
export const MAX_PRICE_BDT = 10_000_000;
export const MAX_LIMIT = 10_000_000;

export const ORG_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export const SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"] as const;
export const BILLING_CYCLES = ["MONTHLY", "ANNUAL"] as const satisfies readonly BillingCycle[];

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
  plan: z.string("Choose a plan").trim().toLowerCase().min(1, "Choose a plan").max(32, "Choose a plan from the catalog"),
  phone: z.string().trim().min(6, "Phone must be at least 6 characters").max(30, "Phone must be 30 characters or fewer").optional().or(z.literal("")).nullable(),
});

/** createOrgSchema plus a check that `plan` is one of the currently ACTIVE plan codes (loaded from the DB). */
export function createOrgSchemaFor(activePlanCodes: readonly string[]) {
  return createOrgSchema.refine((d) => activePlanCodes.includes(d.plan), {
    message: "Choose an active plan from the catalog",
    path: ["plan"],
  });
}

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
  z.object({
    action: z.literal("set-plan"),
    plan: z.string("Choose a plan").trim().toLowerCase().min(1, "Choose a plan").max(32, "Choose a plan from the catalog"),
    billingCycle: z.enum(BILLING_CYCLES, "Choose a billing cycle (MONTHLY or ANNUAL)"),
    priceBdt: z.number("Price must be a whole number of taka").int("Price must be a whole number of taka").min(0, "Price can't be negative").max(MAX_PRICE_BDT, "Price is too large").nullish(),
  }),
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
  plan: filter(z.string().trim().toLowerCase().max(40)),
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

// ── Plans ────────────────────────────────────────────────

/** Plan limit resource that an account of this role counts against. */
export function resourceForRole(role: string): PlanResource {
  return role === "DRIVER" ? "drivers" : "admins";
}

// ── Guard rules ──────────────────────────────────────────────

export function assertCanSuspend(org: { status: string }): void {
  if (org.status === "SUSPENDED") throw new ApiError(409, "This organization is already suspended");
}

export function assertCanReactivate(org: { status: string }): void {
  if (org.status !== "SUSPENDED") throw new ApiError(409, "This organization is not suspended");
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

// ── Plan management (/api/platform/plans) ────────────────────

/** Plan codes are lowercase slugs and immutable once created. */
export const PLAN_CODE_PATTERN = /^[a-z0-9-]{2,32}$/;

const price = z
  .number("Prices must be whole numbers of taka (or empty)")
  .int("Prices must be whole numbers of taka")
  .min(0, "Prices can't be negative")
  .max(MAX_PRICE_BDT, "Price is too large")
  .nullable();
const limit = z
  .number("Limits must be whole numbers (or empty for unlimited)")
  .int("Limits must be whole numbers")
  .min(0, "Limits can't be negative")
  .max(MAX_LIMIT, "Limit is too large — leave it empty for unlimited")
  .nullable();

/** Every PlanInput field except `code` (used by create and update). */
export const planFieldsSchema = z.object({
  name: z.string("Name is required").trim().min(2, "Name must be at least 2 characters").max(60, "Name must be 60 characters or fewer"),
  description: z
    .string("Description must be text")
    .trim()
    .max(300, "Description must be 300 characters or fewer")
    .nullish()
    .transform((v) => (v ? v : null)),
  monthlyPriceBdt: price,
  annualPriceBdt: price,
  limits: z.object(
    { drivers: limit, vehicles: limit, admins: limit, monthlyDeliveries: limit },
    "Limits are required"
  ),
  features: z
    .array(z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]], "Unknown feature"), "Features must be a list")
    .transform((f) => FEATURE_KEYS.filter((k) => f.includes(k))), // dedupe, canonical order
  highlights: z
    .array(
      z.string("Highlights must be text").trim().min(1, "Highlights can't be empty").max(80, "Each highlight must be 80 characters or fewer"),
      "Highlights must be a list"
    )
    .max(8, "At most 8 highlights"),
  isPublic: z.boolean("isPublic must be true or false"),
  sortOrder: z.number("Sort order must be a whole number").int("Sort order must be a whole number").min(-10_000).max(10_000),
});
export type PlanFields = z.infer<typeof planFieldsSchema>;

/** POST /api/platform/plans */
export const planCreateSchema = planFieldsSchema.extend({
  code: z
    .string("Code is required")
    .trim()
    .toLowerCase()
    .regex(PLAN_CODE_PATTERN, "Code must be 2–32 characters: lowercase letters, digits and hyphens"),
});
export type PlanCreate = z.infer<typeof planCreateSchema>;

/** PATCH /api/platform/plans/[code] */
export const planActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), plan: planFieldsSchema, confirmImpact: z.boolean().optional() }),
  z.object({ action: z.literal("activate") }),
  z.object({ action: z.literal("deactivate") }),
  z.object({ action: z.literal("make-default") }),
  z.object({
    action: z.literal("apply-price-to-subscribers"),
    billingCycle: z.enum(BILLING_CYCLES, "Choose a billing cycle (MONTHLY or ANNUAL)"),
  }),
], "Unknown action");
export type ParsedPlanAction = z.infer<typeof planActionSchema>;

/** POST /api/platform/plans/[code]/preview */
export const planPreviewSchema = z.object({ limits: planFieldsSchema.shape.limits });

/** Prisma column values for a plan's editable fields. */
export function planFieldsToData(f: PlanFields) {
  return {
    name: f.name,
    description: f.description,
    monthlyPriceBdt: f.monthlyPriceBdt,
    annualPriceBdt: f.annualPriceBdt,
    maxDrivers: f.limits.drivers,
    maxVehicles: f.limits.vehicles,
    maxAdmins: f.limits.admins,
    maxMonthlyDeliveries: f.limits.monthlyDeliveries,
    features: f.features,
    highlights: f.highlights,
    isPublic: f.isPublic,
    sortOrder: f.sortOrder,
  } satisfies Prisma.PlanUpdateInput;
}

type Change = { from: unknown; to: unknown };

/** Field-by-field diff between the stored plan and the submitted fields (for the audit log). */
export function planDiff(before: PlanDefinition, after: PlanFields): Record<string, Change> {
  const changes: Record<string, Change> = {};
  const cmp = (field: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = { from: a, to: b };
  };
  cmp("name", before.name, after.name);
  cmp("description", before.description, after.description);
  cmp("monthlyPriceBdt", before.monthlyPriceBdt, after.monthlyPriceBdt);
  cmp("annualPriceBdt", before.annualPriceBdt, after.annualPriceBdt);
  for (const r of PLAN_RESOURCES) cmp(`limits.${r}`, before.limits[r], after.limits[r]);
  cmp("features", [...before.features].sort(), [...after.features].sort());
  cmp("highlights", before.highlights, after.highlights);
  cmp("isPublic", before.isPublic, after.isPublic);
  cmp("sortOrder", before.sortOrder, after.sortOrder);
  return changes;
}

/** Resources whose limit gets stricter (lower, or from unlimited to a number). */
export function tightenedResources(
  before: Record<PlanResource, number | null>,
  after: Record<PlanResource, number | null>
): PlanResource[] {
  return PLAN_RESOURCES.filter((r) => {
    const next = after[r];
    const prev = before[r];
    return next !== null && (prev === null || next < prev);
  });
}

/** 409 carrying the limit impact, so the console can ask for confirmation. */
export class PlanImpactError extends ApiError {
  impact: LimitImpactRow[];
  constructor(impact: LimitImpactRow[]) {
    const n = impact.length;
    super(
      409,
      `${n} organization${n === 1 ? " is" : "s are"} already over the new limits. Their existing data stays untouched, ` +
        "but they won't be able to add more until usage drops. Confirm to save anyway."
    );
    this.impact = impact;
  }
}

/**
 * Limit changes apply live to every subscriber, so a stricter limit that puts
 * someone over must be confirmed. Only resources that actually got stricter
 * trigger the check (an org already over an unchanged limit doesn't block
 * editing, say, the description); the full impact is returned for display.
 */
export function assertImpactConfirmed(
  before: Record<PlanResource, number | null>,
  after: Record<PlanResource, number | null>,
  impact: LimitImpactRow[],
  confirmImpact: boolean | undefined
): void {
  const tightened = tightenedResources(before, after);
  const blocking = impact.some((row) => row.over.some((o) => tightened.includes(o.resource)));
  if (blocking && !confirmImpact) throw new PlanImpactError(impact);
}

export function assertCanActivate(plan: Pick<PlanDefinition, "active">): void {
  if (plan.active) throw new ApiError(409, "This plan is already active");
}

export function assertCanDeactivate(plan: Pick<PlanDefinition, "active" | "isDefault">): void {
  if (plan.isDefault) throw new ApiError(409, "The default plan can't be deactivated — make another plan the default first");
  if (!plan.active) throw new ApiError(409, "This plan is already inactive");
}

export function assertCanMakeDefault(plan: Pick<PlanDefinition, "active" | "isDefault">): void {
  if (plan.isDefault) throw new ApiError(409, "This plan is already the default");
  if (!plan.active) throw new ApiError(409, "Activate this plan before making it the default");
}

const isFree = (plan: Pick<PlanDefinition, "monthlyPriceBdt" | "annualPriceBdt">) =>
  plan.monthlyPriceBdt === null && plan.annualPriceBdt === null;

/**
 * Price snapshot stored on the organization when a plan is assigned:
 * an explicit (negotiated) `priceBdt`, else the plan's list price for the
 * cycle. A plan that's free on both cycles snapshots null (free); a paid
 * plan without a price for the chosen cycle needs an explicit price.
 */
export function resolveSnapshotPrice(
  plan: Pick<PlanDefinition, "name" | "monthlyPriceBdt" | "annualPriceBdt">,
  cycle: BillingCycle,
  priceBdt?: number | null
): number | null {
  if (priceBdt !== undefined && priceBdt !== null) return priceBdt;
  const list = listPrice(plan, cycle);
  if (list !== null || isFree(plan)) return list;
  throw new ApiError(
    400,
    `The ${plan.name} plan has no ${cycle === "ANNUAL" ? "annual" : "monthly"} price — choose the other billing cycle or enter a price`
  );
}

/**
 * Guard rules for set-plan. Only ACTIVE plans can be newly assigned, but an
 * org may stay on its current (inactive) plan while its cycle or price
 * changes. Refuses a no-op. Returns the price snapshot to store.
 */
export function checkSetPlan(
  org: { plan: string; billingCycle: string; subscriptionPriceBdt: number | null },
  target: Pick<PlanDefinition, "code" | "name" | "active" | "monthlyPriceBdt" | "annualPriceBdt"> | null,
  cycle: BillingCycle,
  priceBdt?: number | null
): { snapshot: number | null } {
  if (!target) throw new ApiError(400, "Choose an existing plan");
  if (target.code !== org.plan && !target.active) {
    throw new ApiError(409, `The ${target.name} plan is inactive and can't be newly assigned`);
  }
  const snapshot = resolveSnapshotPrice(target, cycle, priceBdt);
  if (target.code === org.plan && cycle === org.billingCycle && snapshot === org.subscriptionPriceBdt) {
    throw new ApiError(409, "The organization is already on this plan, billing cycle and price");
  }
  return { snapshot };
}

export function toBillingCycle(value: string): BillingCycle {
  return value === "ANNUAL" ? "ANNUAL" : "MONTHLY";
}

/** Subscriber counts per plan from a groupBy over (plan, billingCycle, subscriptionPriceBdt). */
export function summarizePlans(
  plans: PlanDefinition[],
  groups: { plan: string; billingCycle: string; subscriptionPriceBdt: number | null; count: number }[]
): PlatformPlansData {
  return {
    plans: plans.map((p) => {
      const mine = groups.filter((g) => g.plan === p.code);
      return {
        ...p,
        organizationCount: mine.reduce((s, g) => s + g.count, 0),
        grandfatheredCount: mine
          .filter((g) => g.subscriptionPriceBdt !== listPrice(p, toBillingCycle(g.billingCycle)))
          .reduce((s, g) => s + g.count, 0),
      };
    }),
  };
}

/**
 * Platform audit row about a plan. platformAuditData's targetType union
 * predates plans, so the target type is overridden here.
 */
export function planAuditData(input: {
  actor: Pick<PlatformAdmin, "id" | "name">;
  action: string;
  code: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}) {
  return {
    ...platformAuditData({ actor: input.actor, action: input.action, targetType: "Organization", targetId: input.code, detail: input.detail ?? null, ip: input.ip }),
    targetType: "Plan",
  };
}

/** Tenant-visible note on rows written by apply-price-to-subscribers. */
export const PRICE_APPLIED_NOTE = "Plan price updated by FleetFlow support";
