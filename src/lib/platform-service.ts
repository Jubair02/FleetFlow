import { z } from "zod";
import type { PlatformAdmin, Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { auditData } from "@/lib/notify";
import { platformAuditData } from "@/lib/platform-auth";
import {
  FEATURE_KEYS, PLAN_RESOURCES, listPrice,
  type BillingCycle, type FeatureKey, type PlanDefinition, type PlanResource,
} from "@/lib/plan-catalog";
import { isValidTimezone } from "@/lib/timezone";
import type {
  LimitImpactRow, OrgDeletionCounts, Paged, PlatformAdminInfo, PlatformAuditRow, PlatformOrgDeliveryRow, PlatformPlansData, PlatformUserRow, OrgStatus,
} from "@/lib/platform-types";

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

/** Optional profile text: "" / whitespace / null clear the field (stored as null); undefined leaves it unchanged. */
const clearable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable().optional());

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
    action: z.literal("update-profile"),
    name: z.string("Company name must be text").trim().min(2, "Company name must be at least 2 characters").max(120, "Company name must be 120 characters or fewer").optional(),
    contactEmail: clearable(email),
    phone: clearable(z.string("Phone must be text").trim().min(6, "Phone must be at least 6 characters").max(30, "Phone must be 30 characters or fewer")),
    address: clearable(z.string("Address must be text").trim().max(300, "Address must be 300 characters or fewer")),
    defaultPickupAddress: clearable(z.string("Default pickup address must be text").trim().max(300, "Default pickup address must be 300 characters or fewer")),
    timezone: z
      .string("Select a timezone")
      .trim()
      .min(1, "Select a timezone")
      .max(64, "Select a valid timezone")
      .refine((tz) => isValidTimezone(tz), "Select a valid timezone")
      .optional(),
  }),
  z.object({
    action: z.literal("update-subscription"),
    subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES, "Choose a valid subscription status"),
    paidUntil: isoDate.nullable(),
    billingNotes: z.string().trim().max(1000, "Billing notes must be 1000 characters or fewer").nullable(),
  }),
], "Unknown action");
export type ParsedOrgAction = z.infer<typeof orgActionSchema>;

/** Organization profile fields a platform admin may edit ("update-profile"). */
export const ORG_PROFILE_FIELDS = ["name", "contactEmail", "phone", "address", "defaultPickupAddress", "timezone"] as const;
export type OrgProfileField = (typeof ORG_PROFILE_FIELDS)[number];
type OrgProfile = { name: string; timezone: string } & Record<Exclude<OrgProfileField, "name" | "timezone">, string | null>;
/** Changed columns only; name and timezone are never cleared. */
export type OrgProfileChanges = Partial<OrgProfile>;

/** Tenant-visible note on the audit row written by "update-profile". */
export const PROFILE_UPDATED_NOTE = "Company details updated by FleetFlow support";

/**
 * Only the fields that actually change (undefined = not sent = unchanged).
 * Name and timezone are required and can't be cleared; the others clear to null.
 */
export function profileChanges(
  current: OrgProfile,
  input: Partial<Record<OrgProfileField, string | null | undefined>>
): OrgProfileChanges {
  const data: Record<string, string | null> = {};
  for (const key of ORG_PROFILE_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    if (key === "name" || key === "timezone") {
      if (value && value !== current[key]) data[key] = value;
      continue;
    }
    const next = value === "" ? null : value;
    if (next !== (current[key] ?? null)) data[key] = next;
  }
  return data as OrgProfileChanges;
}

/** Delivered ÷ (delivered + failed) as a percentage with one decimal; null when nothing finished. */
export function successRate(delivered: number, failed: number): number | null {
  const finished = delivered + failed;
  if (!Number.isFinite(finished) || finished <= 0) return null;
  return Math.round((delivered / finished) * 1000) / 10;
}

export const ORG_DELIVERIES_PAGE_SIZE = 10;

export const orgDeliveriesQuery = z.object({
  page: z.preprocess((v) => (v === null || v === "" ? undefined : v), z.coerce.number().int("Invalid page").min(1, "Invalid page").max(100_000).default(1)),
  pageSize: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.coerce.number().int("Invalid page size").min(5, "Page size must be 5–50").max(50, "Page size must be 5–50").default(ORG_DELIVERIES_PAGE_SIZE)
  ),
});

/**
 * Explicit select for the organization deliveries tab — no tracking token,
 * recipient phone/email or addresses. The driver is the latest assignment
 * that wasn't unassigned (active, or closed as delivered/failed).
 */
export const ORG_DELIVERY_SELECT = {
  id: true,
  trackingCode: true,
  recipientName: true,
  status: true,
  createdAt: true,
  expectedAt: true,
  assignments: {
    where: { OR: [{ active: true }, { outcome: { in: ["DELIVERED", "FAILED"] } }] },
    orderBy: { assignedAt: "desc" },
    take: 1,
    select: { driver: { select: { name: true } } },
  },
} satisfies Prisma.DeliverySelect;

type OrgDeliveryRecord = Prisma.DeliveryGetPayload<{ select: typeof ORG_DELIVERY_SELECT }>;

export function toOrgDeliveryRow(d: OrgDeliveryRecord): PlatformOrgDeliveryRow {
  return {
    id: d.id,
    trackingCode: d.trackingCode,
    recipientName: d.recipientName,
    status: d.status,
    driverName: d.assignments[0]?.driver.name ?? null,
    createdAt: d.createdAt.toISOString(),
    expectedAt: d.expectedAt ? d.expectedAt.toISOString() : null,
  };
}

export const userActionSchema = z.object({
  action: z.enum(["deactivate", "activate", "reset-password", "revoke-sessions"], "Unknown action"),
});

/** Query-string values: "", "all" and missing all mean "no filter". */
const filter = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === null || v === "" || v === "all" ? undefined : v), schema.optional());

const page = z.preprocess((v) => (v === null || v === "" ? undefined : v), z.coerce.number().int("Invalid page").min(1, "Invalid page").max(100_000).default(1));
const search = filter(z.string().trim().max(100, "Search must be 100 characters or fewer"));
const id = filter(z.string().trim().min(1).max(64));

/** Page sizes the organizations list accepts (?pageSize=); absent → ORG_PAGE_SIZE. */
export const ORG_PAGE_SIZES = [10, 20, 50] as const;
/** Most rows one ?export=1 request returns. */
export const ORG_EXPORT_CAP = 5000;

const dayParam = filter(
  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD").refine((v) => isValidIsoDay(v), "Invalid date")
);

export const orgListQuery = z.object({
  search,
  status: filter(z.enum(ORG_STATUSES, "Invalid status")),
  plan: filter(z.string().trim().toLowerCase().max(40)),
  page,
  // Additive filters (all optional, no defaults, so older callers parse unchanged).
  pageSize: filter(
    z.coerce.number().int("Invalid page size").refine((n) => (ORG_PAGE_SIZES as readonly number[]).includes(n), "Page size must be 10, 20 or 50")
  ),
  subscription: filter(z.enum(SUBSCRIPTION_STATUSES, "Invalid subscription status")),
  from: dayParam,
  to: dayParam,
  export: filter(z.enum(["1", "true"], "Invalid export flag")),
});

/** True for a real calendar day "YYYY-MM-DD" (rejects 2026-02-30). */
export function isValidIsoDay(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * Registered-date filter from ?from=&to= (UTC days, both inclusive) →
 * a Prisma createdAt range { gte, lt }. Throws 400 when from is after to.
 * Returns null when neither bound is given.
 */
export function parseRegisteredRange(from?: string, to?: string): { gte?: Date; lt?: Date } | null {
  if (!from && !to) return null;
  for (const v of [from, to]) {
    if (v !== undefined && !isValidIsoDay(v)) throw new ApiError(400, "Dates must be valid YYYY-MM-DD days");
  }
  if (from && to && from > to) throw new ApiError(400, "The start date must be on or before the end date");
  const range: { gte?: Date; lt?: Date } = {};
  if (from) range.gte = new Date(`${from}T00:00:00.000Z`);
  if (to) {
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    range.lt = end;
  }
  return range;
}

/** `now` minus `days` × 24h (rolling windows such as "this week" / "last 30 days"). */
export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

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

// ── Permanent organization deletion ──────────────────────────

export const DELETE_REQUIRES_SUSPENSION = "Suspend the organization before deleting it";
export const DELETE_NAME_MISMATCH = "Type the organization name exactly to confirm";

/** The confirmation is compared byte-for-byte with the stored name: no trimming or case folding. */
export const deleteOrgSchema = z.object({
  confirmName: z.string(DELETE_NAME_MISMATCH).min(1, DELETE_NAME_MISMATCH).max(500, DELETE_NAME_MISMATCH),
});

/** A large organization can take a while to remove; still one atomic transaction. */
export const ORG_DELETE_TX_OPTIONS = { maxWait: 15_000, timeout: 120_000 } as const;

/** Only a SUSPENDED organization, confirmed by its exact name, can be deleted. */
export function assertCanDelete(org: { status: string; name: string }, confirmName: string): void {
  if (org.status !== "SUSPENDED") throw new ApiError(409, DELETE_REQUIRES_SUSPENSION);
  if (confirmName !== org.name) throw new ApiError(400, DELETE_NAME_MISMATCH);
}

/**
 * Where-clauses for every row owned by ONE organization — each one scoped to that
 * organization id directly or through a relation filter, never global.
 */
export function orgDeletionWhere(organizationId: string) {
  const ownDelivery = { delivery: { organizationId } };
  const ownUser = { user: { organizationId } };
  return {
    sessions: ownUser satisfies Prisma.SessionWhereInput,
    notifications: { OR: [{ organizationId }, ownUser] } satisfies Prisma.NotificationWhereInput,
    proofOfDelivery: ownDelivery satisfies Prisma.ProofOfDeliveryWhereInput,
    deliveryEvents: ownDelivery satisfies Prisma.DeliveryEventWhereInput,
    assignments: ownDelivery satisfies Prisma.AssignmentWhereInput,
    deliveries: { organizationId } satisfies Prisma.DeliveryWhereInput,
    importBatches: { organizationId } satisfies Prisma.ImportBatchWhereInput,
    driverProfiles: ownUser satisfies Prisma.DriverProfileWhereInput,
    vehicles: { organizationId } satisfies Prisma.VehicleWhereInput,
    users: { organizationId } satisfies Prisma.UserWhereInput,
    drivers: { organizationId, role: "DRIVER" } satisfies Prisma.UserWhereInput,
    auditLogs: { organizationId } satisfies Prisma.AuditLogWhereInput,
  };
}

/** Read-only counts of what a deletion would remove (delete preview). */
export async function countOrgData(client: Prisma.TransactionClient, organizationId: string): Promise<OrgDeletionCounts> {
  const w = orgDeletionWhere(organizationId);
  const [users, drivers, driverProfiles, sessions, vehicles, deliveries, proofOfDelivery, deliveryEvents, assignments, importBatches, notifications, auditLogs] =
    await Promise.all([
      client.user.count({ where: w.users }),
      client.user.count({ where: w.drivers }),
      client.driverProfile.count({ where: w.driverProfiles }),
      client.session.count({ where: w.sessions }),
      client.vehicle.count({ where: w.vehicles }),
      client.delivery.count({ where: w.deliveries }),
      client.proofOfDelivery.count({ where: w.proofOfDelivery }),
      client.deliveryEvent.count({ where: w.deliveryEvents }),
      client.assignment.count({ where: w.assignments }),
      client.importBatch.count({ where: w.importBatches }),
      client.notification.count({ where: w.notifications }),
      client.auditLog.count({ where: w.auditLogs }),
    ]);
  return { users, drivers, driverProfiles, sessions, vehicles, deliveries, proofOfDelivery, deliveryEvents, assignments, importBatches, notifications, auditLogs };
}

/**
 * Delete every row of one organization (call inside a transaction that holds the
 * organization row lock). Order follows the FK graph in prisma/schema.prisma:
 * children before parents, the Organization row last. Returns the deleted counts.
 * A row of ANOTHER organization that still references this one (e.g. an event
 * authored by one of its users) makes a delete fail, rolling everything back.
 */
export async function deleteOrgData(tx: Prisma.TransactionClient, organizationId: string): Promise<OrgDeletionCounts> {
  const w = orgDeletionWhere(organizationId);
  const drivers = await tx.user.count({ where: w.drivers });
  const sessions = (await tx.session.deleteMany({ where: w.sessions })).count;
  const notifications = (await tx.notification.deleteMany({ where: w.notifications })).count;
  const proofOfDelivery = (await tx.proofOfDelivery.deleteMany({ where: w.proofOfDelivery })).count;
  const deliveryEvents = (await tx.deliveryEvent.deleteMany({ where: w.deliveryEvents })).count;
  const assignments = (await tx.assignment.deleteMany({ where: w.assignments })).count;
  const deliveries = (await tx.delivery.deleteMany({ where: w.deliveries })).count;
  const importBatches = (await tx.importBatch.deleteMany({ where: w.importBatches })).count;
  const driverProfiles = (await tx.driverProfile.deleteMany({ where: w.driverProfiles })).count;
  const vehicles = (await tx.vehicle.deleteMany({ where: w.vehicles })).count;
  const users = (await tx.user.deleteMany({ where: w.users })).count;
  const auditLogs = (await tx.auditLog.deleteMany({ where: w.auditLogs })).count;
  await tx.organization.delete({ where: { id: organizationId } });
  return { users, drivers, driverProfiles, sessions, vehicles, deliveries, proofOfDelivery, deliveryEvents, assignments, importBatches, notifications, auditLogs };
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
