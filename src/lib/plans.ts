import type { Plan, Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { table } from "@/lib/delivery";
import { DEFAULT_TIMEZONE, startOfMonthInTz } from "@/lib/timezone";
import {
  FEATURES,
  FEATURE_KEYS,
  PLAN_RESOURCES,
  RESOURCE_LABELS,
  type FeatureKey,
  type PlanDefinition,
  type PlanResource,
} from "@/lib/plan-catalog";

// ─────────────────────────────────────────────────────────────
// Server-only plan loading & enforcement. Plans are rows in the Plan
// table (edited in the platform console); Organization.plan → Plan.code.
//
// Limits are live: changing a plan's limit affects every subscriber, but
// only NEW additions are ever refused — existing data is never removed.
// Prices are snapshotted on the Organization when a plan is assigned
// (subscriptionPriceBdt / billingCycle), so price edits don't silently
// change what existing customers pay.
// ─────────────────────────────────────────────────────────────

export * from "@/lib/plan-catalog";

type Db = Prisma.TransactionClient;

export function toPlanDefinition(p: Plan): PlanDefinition {
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    monthlyPriceBdt: p.monthlyPriceBdt,
    annualPriceBdt: p.annualPriceBdt,
    limits: { drivers: p.maxDrivers, vehicles: p.maxVehicles, admins: p.maxAdmins, monthlyDeliveries: p.maxMonthlyDeliveries },
    // ignore unknown/legacy keys so a stale value can't grant anything
    features: p.features.filter((f): f is FeatureKey => (FEATURE_KEYS as string[]).includes(f)),
    highlights: p.highlights,
    active: p.active,
    isPublic: p.isPublic,
    isDefault: p.isDefault,
    sortOrder: p.sortOrder,
  };
}

const PLAN_ORDER = [{ sortOrder: "asc" as const }, { code: "asc" as const }];

export async function listPlans(db: Db, opts: { activeOnly?: boolean; publicOnly?: boolean } = {}): Promise<PlanDefinition[]> {
  const rows = await db.plan.findMany({
    where: { ...(opts.activeOnly ? { active: true } : {}), ...(opts.publicOnly ? { isPublic: true } : {}) },
    orderBy: PLAN_ORDER,
  });
  return rows.map(toPlanDefinition);
}

export async function getDefaultPlan(db: Db): Promise<PlanDefinition> {
  const row = (await db.plan.findFirst({ where: { isDefault: true } })) ?? (await db.plan.findFirst({ orderBy: PLAN_ORDER }));
  if (!row) throw new ApiError(500, "No subscription plans are configured");
  return toPlanDefinition(row);
}

export async function getPlanByCode(db: Db, code: string): Promise<PlanDefinition | null> {
  const row = await db.plan.findUnique({ where: { code } });
  return row ? toPlanDefinition(row) : null;
}

/** The plan an organization is on (FK guarantees it exists). */
export async function getOrgPlan(db: Db, organizationId: string): Promise<PlanDefinition> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { planRecord: true } });
  if (!org) throw new ApiError(404, "Organization not found");
  return toPlanDefinition(org.planRecord);
}

/** Current usage of every limited resource for an organization. */
export async function getUsage(db: Db, organizationId: string, timezone = DEFAULT_TIMEZONE): Promise<Record<PlanResource, number>> {
  const monthStart = startOfMonthInTz(new Date(), timezone);
  const [drivers, vehicles, admins, monthlyDeliveries] = await Promise.all([
    db.user.count({ where: { organizationId, role: "DRIVER", active: true } }),
    db.vehicle.count({ where: { organizationId, status: { not: "INACTIVE" } } }),
    db.user.count({ where: { organizationId, role: "ADMIN", active: true } }),
    db.delivery.count({ where: { organizationId, createdAt: { gte: monthStart } } }),
  ]);
  return { drivers, vehicles, admins, monthlyDeliveries };
}

/**
 * Throw 403 if adding `adding` units of `resource` would exceed the plan.
 * Call inside the write transaction: it locks the organization row so two
 * concurrent creates can't both slip under the limit. Existing data over a
 * limit is never touched — only new additions are refused.
 */
export async function assertPlanLimit(tx: Db, organizationId: string, resource: PlanResource, adding = 1): Promise<void> {
  const rows = await tx.$queryRaw<{ timezone: string }[]>`
    SELECT timezone FROM ${table("Organization")} WHERE id = ${organizationId} FOR UPDATE`;
  const org = rows[0];
  if (!org) throw new ApiError(404, "Organization not found");
  const plan = await getOrgPlan(tx, organizationId);
  const limit = plan.limits[resource];
  if (limit === null) return;
  const usage = (await getUsage(tx, organizationId, org.timezone))[resource];
  if (usage + adding > limit) {
    const room = Math.max(0, limit - usage);
    throw new ApiError(
      403,
      `Your ${plan.name} plan allows ${limit} ${RESOURCE_LABELS[resource]} (currently ${usage}` +
        `${adding > 1 ? `; this would add ${adding}, room for ${room}` : ""}). Contact FleetFlow to upgrade your plan.`
    );
  }
}

/** Throw 403 unless the organization's plan includes `feature`. */
export async function assertFeature(db: Db, organizationId: string, feature: FeatureKey): Promise<void> {
  const plan = await getOrgPlan(db, organizationId);
  if (!plan.features.includes(feature)) {
    throw new ApiError(403, `${FEATURES[feature].label} isn't included in your ${plan.name} plan. Contact FleetFlow to upgrade.`);
  }
}

/** Non-throwing variant for optional side effects (e.g. customer emails). */
export async function orgHasFeature(db: Db, organizationId: string, feature: FeatureKey): Promise<boolean> {
  return (await getOrgPlan(db, organizationId)).features.includes(feature);
}

export interface LimitImpact {
  organizationId: string;
  organizationName: string;
  /** Resources where current usage would exceed the proposed limit. */
  over: { resource: PlanResource; usage: number; limit: number }[];
}

/**
 * Which subscribers of `planCode` would be over the proposed limits. Used to
 * preview a limit decrease before saving it (nothing is changed here).
 */
export async function previewLimitImpact(db: Db, planCode: string, limits: Record<PlanResource, number | null>): Promise<LimitImpact[]> {
  const orgs = await db.organization.findMany({ where: { plan: planCode }, select: { id: true, name: true, timezone: true } });
  const impacts: LimitImpact[] = [];
  for (const o of orgs) {
    const usage = await getUsage(db, o.id, o.timezone);
    const over = PLAN_RESOURCES.flatMap((r) => {
      const limit = limits[r];
      return limit !== null && usage[r] > limit ? [{ resource: r, usage: usage[r], limit }] : [];
    });
    if (over.length) impacts.push({ organizationId: o.id, organizationName: o.name, over });
  }
  return impacts;
}
