import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { table } from "@/lib/delivery";
import { DEFAULT_TIMEZONE, startOfMonthInTz } from "@/lib/timezone";

// Server-only plan usage & enforcement. The plan catalog itself (client-safe)
// lives in src/lib/plan-catalog.ts and is re-exported here for server code.
import { getPlan, RESOURCE_LABELS, type PlanResource } from "@/lib/plan-catalog";
export * from "@/lib/plan-catalog";

type Db = Prisma.TransactionClient;

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
  const rows = await tx.$queryRaw<{ plan: string; timezone: string }[]>`
    SELECT plan, timezone FROM ${table("Organization")} WHERE id = ${organizationId} FOR UPDATE`;
  const org = rows[0];
  if (!org) throw new ApiError(404, "Organization not found");
  const plan = getPlan(org.plan);
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

