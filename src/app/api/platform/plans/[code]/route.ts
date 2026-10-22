import { NextResponse } from "next/server";
import type { Plan, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { table, TX_OPTIONS } from "@/lib/delivery";
import { PLAN_RESOURCES, previewLimitImpact, toPlanDefinition } from "@/lib/plans";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import {
  PRICE_APPLIED_NOTE, PlanImpactError, assertCanActivate, assertCanDeactivate, assertCanMakeDefault, assertImpactConfirmed,
  parseBody, planActionSchema, planAuditData, planDiff, planFieldsToData, resolveSnapshotPrice, supportAuditData,
} from "@/lib/platform-service";
import type { LimitImpactRow } from "@/lib/platform-types";

type Params = { params: Promise<{ code: string }> };

/** Lock the plan row for the rest of the transaction (404 if it doesn't exist). */
async function lockPlan(tx: Prisma.TransactionClient, code: string): Promise<Plan> {
  const locked = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM ${table("Plan")} WHERE code = ${code} FOR UPDATE`;
  if (!locked.length) throw new ApiError(404, "Plan not found");
  return tx.plan.findUniqueOrThrow({ where: { code } });
}

const sameLimits = (a: Record<string, number | null>, b: Record<string, number | null>) => PLAN_RESOURCES.every((r) => a[r] === b[r]);

// PATCH /api/platform/plans/[code] — see PlatformPlansData / LimitImpactRow docs in src/lib/platform-types.ts.
//  update                     → { success, plan, changed }   (409 { error, impact } until confirmImpact)
//  activate | deactivate      → { success, plan }
//  make-default               → { success, plan }
//  apply-price-to-subscribers → { success, updated }
// Plans are never deleted and codes never change.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const admin = await requirePlatformAdmin();
    const code = (await params).code.trim().toLowerCase();
    const input = parseBody(planActionSchema, await readJson<unknown>(req));
    const ip = clientIp(req);

    switch (input.action) {
      case "update": {
        const current = await db.plan.findUnique({ where: { code } });
        if (!current) throw new ApiError(404, "Plan not found");
        const before = toPlanDefinition(current);
        const nextLimits = input.plan.limits;

        // Read-only impact check outside the write transaction (it counts usage per subscriber).
        let impact: LimitImpactRow[] = [];
        if (!sameLimits(before.limits, nextLimits)) {
          impact = await previewLimitImpact(db, code, nextLimits);
          assertImpactConfirmed(before.limits, nextLimits, impact, input.confirmImpact);
        }

        const result = await db.$transaction(async (tx) => {
          const row = await lockPlan(tx, code);
          const locked = toPlanDefinition(row);
          // The impact was computed against `before`; refuse if limits moved underneath us.
          if (!sameLimits(locked.limits, before.limits)) {
            throw new ApiError(409, "This plan was changed by someone else meanwhile — reload and try again");
          }
          const changes = planDiff(locked, input.plan);
          const changed = Object.keys(changes);
          if (!changed.length) return { plan: locked, changed };
          // Limits apply to all subscribers immediately; prices change the LIST price only
          // (subscriber snapshots in Organization.subscriptionPriceBdt are untouched).
          const updated = await tx.plan.update({ where: { code }, data: planFieldsToData(input.plan) });
          await tx.platformAuditLog.create({
            data: planAuditData({
              actor: admin, action: "PLAN_UPDATED", code, ip,
              detail: { changes, organizationsOverNewLimits: impact.length, impactConfirmed: impact.length > 0 && !!input.confirmImpact },
            }),
          });
          return { plan: toPlanDefinition(updated), changed };
        }, TX_OPTIONS);
        return ok({ success: true, ...result });
      }

      case "activate":
      case "deactivate": {
        const plan = await db.$transaction(async (tx) => {
          const row = await lockPlan(tx, code);
          // Deactivated plans can't be newly assigned; existing subscribers keep them.
          if (input.action === "activate") assertCanActivate(row);
          else assertCanDeactivate(row);
          const updated = await tx.plan.update({ where: { code }, data: { active: input.action === "activate" } });
          const subscribers = await tx.organization.count({ where: { plan: code } });
          await tx.platformAuditLog.create({
            data: planAuditData({
              actor: admin, action: input.action === "activate" ? "PLAN_ACTIVATED" : "PLAN_DEACTIVATED", code, ip,
              detail: { name: row.name, subscribers },
            }),
          });
          return toPlanDefinition(updated);
        }, TX_OPTIONS);
        return ok({ success: true, plan });
      }

      case "make-default": {
        const plan = await db.$transaction(async (tx) => {
          const row = await lockPlan(tx, code);
          assertCanMakeDefault(row);
          const previous = await tx.plan.findFirst({ where: { isDefault: true }, select: { code: true } });
          // Unset first: the partial unique index allows only one isDefault row at a time.
          await tx.plan.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
          const updated = await tx.plan.update({ where: { code }, data: { isDefault: true } });
          await tx.platformAuditLog.create({
            data: planAuditData({ actor: admin, action: "PLAN_DEFAULT_CHANGED", code, ip, detail: { from: previous?.code ?? null, to: code } }),
          });
          return toPlanDefinition(updated);
        }, TX_OPTIONS);
        return ok({ success: true, plan });
      }

      case "apply-price-to-subscribers": {
        const cycle = input.billingCycle;
        const updated = await db.$transaction(async (tx) => {
          const row = await lockPlan(tx, code);
          const def = toPlanDefinition(row);
          const price = resolveSnapshotPrice(def, cycle); // 400 when the plan has no price on this cycle
          // Lock the subscribers so a concurrent set-plan can't interleave.
          const subs = await tx.$queryRaw<{ id: string; subscriptionPriceBdt: number | null }[]>`
            SELECT id, "subscriptionPriceBdt" FROM ${table("Organization")}
            WHERE plan = ${code} AND "billingCycle" = ${cycle} FOR UPDATE`;
          const stale = subs.filter((s) => s.subscriptionPriceBdt !== price);
          if (!stale.length) return 0;

          const { count } = await tx.organization.updateMany({
            where: { id: { in: stale.map((s) => s.id) }, plan: code, billingCycle: cycle },
            data: { subscriptionPriceBdt: price },
          });
          await tx.auditLog.createMany({
            data: stale.map((s) =>
              supportAuditData({
                organizationId: s.id, action: "PLAN_PRICE_UPDATED", entityType: "Organization", entityId: s.id,
                detail: { note: PRICE_APPLIED_NOTE, plan: code, billingCycle: cycle, from: s.subscriptionPriceBdt, to: price },
              })
            ),
          });
          await tx.platformAuditLog.create({
            data: planAuditData({ actor: admin, action: "PLAN_PRICE_APPLIED", code, ip, detail: { billingCycle: cycle, priceBdt: price, updated: count } }),
          });
          return count;
        }, TX_OPTIONS);
        return ok({ success: true, updated });
      }
    }
  } catch (e) {
    if (e instanceof PlanImpactError) return NextResponse.json({ error: e.message, impact: e.impact }, { status: 409 });
    return fail(e);
  }
}
