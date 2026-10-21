import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { table, TX_OPTIONS } from "@/lib/delivery";
import { getUsage } from "@/lib/plans";
import { platformAuditData, requirePlatformAdmin } from "@/lib/platform-auth";
import {
  REACTIVATION_DATA, USER_ROW_SELECT, assertCanReactivate, assertCanSuspend, assertPlanChange, orgActionSchema,
  orgSessionsWhere, parseBody, parsePaidUntil, planLimits, supportAuditData, suspensionData, toAuditRow, toUserRow,
} from "@/lib/platform-service";
import type { OrgStatus, PlatformOrgDetail, SubscriptionStatus } from "@/lib/platform-types";

type Params = { params: Promise<{ id: string }> };

const MAX_USERS = 500;

// GET /api/platform/organizations/[id] → PlatformOrgDetail
export async function GET(_req: Request, { params }: Params) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const org = await db.organization.findUnique({ where: { id } });
    if (!org) throw new ApiError(404, "Organization not found");

    const [usage, users, activity, actions] = await Promise.all([
      getUsage(db, org.id, org.timezone),
      db.user.findMany({
        where: { organizationId: org.id },
        select: USER_ROW_SELECT,
        orderBy: [{ role: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: MAX_USERS,
      }),
      db.auditLog.findMany({
        where: { organizationId: org.id },
        select: { id: true, action: true, actorName: true, entityType: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
      db.platformAuditLog.findMany({
        where: { organizationId: org.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
    ]);

    const names = new Map([[org.id, org.name]]);
    const body: PlatformOrgDetail = {
      organization: {
        id: org.id,
        name: org.name,
        status: org.status as OrgStatus,
        suspendedAt: org.suspendedAt?.toISOString() ?? null,
        suspendedReason: org.suspendedReason,
        plan: org.plan,
        subscriptionStatus: org.subscriptionStatus as SubscriptionStatus,
        paidUntil: org.paidUntil?.toISOString() ?? null,
        billingNotes: org.billingNotes,
        phone: org.phone,
        contactEmail: org.contactEmail,
        address: org.address,
        timezone: org.timezone,
        createdAt: org.createdAt.toISOString(),
      },
      usage,
      limits: planLimits(org.plan),
      users: users.map(toUserRow),
      recentActivity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      platformActions: actions.map((a) => toAuditRow(a, names)),
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/platform/organizations/[id] — OrgAction → { success }
// Every write is scoped to this organization (where: { id } / { organizationId: id }).
export async function PATCH(req: Request, { params }: Params) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await params;
    const input = parseBody(orgActionSchema, await readJson<unknown>(req));
    const ip = clientIp(req);

    await db.$transaction(async (tx) => {
      // Serialize with other platform actions and plan-limit checks on this organization.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ${table("Organization")} WHERE id = ${id} FOR UPDATE`;
      if (!locked.length) throw new ApiError(404, "Organization not found");
      const org = await tx.organization.findUniqueOrThrow({ where: { id } });

      let platformAction: string;
      let tenantAction: string;
      let detail: Record<string, unknown>;

      switch (input.action) {
        case "suspend": {
          assertCanSuspend(org);
          await tx.organization.update({ where: { id }, data: suspensionData(input.reason, new Date()) });
          // Cut access immediately: drop every tenant session of this organization only. Data is untouched.
          const { count } = await tx.session.deleteMany({ where: orgSessionsWhere(id) });
          platformAction = "ORG_SUSPENDED";
          tenantAction = "ORGANIZATION_SUSPENDED";
          detail = { reason: input.reason, sessionsRevoked: count };
          break;
        }
        case "reactivate": {
          assertCanReactivate(org);
          await tx.organization.update({ where: { id }, data: REACTIVATION_DATA });
          platformAction = "ORG_REACTIVATED";
          tenantAction = "ORGANIZATION_REACTIVATED";
          detail = { previousReason: org.suspendedReason, suspendedAt: org.suspendedAt?.toISOString() ?? null };
          break;
        }
        case "set-plan": {
          assertPlanChange(org.plan, input.plan);
          await tx.organization.update({ where: { id }, data: { plan: input.plan } });
          platformAction = "PLAN_CHANGED";
          tenantAction = "PLAN_CHANGED";
          detail = { from: org.plan, to: input.plan };
          break;
        }
        case "update-subscription": {
          const next = {
            subscriptionStatus: input.subscriptionStatus,
            paidUntil: parsePaidUntil(input.paidUntil),
            billingNotes: input.billingNotes ? input.billingNotes : null,
          };
          await tx.organization.update({ where: { id }, data: next });
          platformAction = "SUBSCRIPTION_UPDATED";
          tenantAction = "SUBSCRIPTION_UPDATED";
          detail = {
            from: { subscriptionStatus: org.subscriptionStatus, paidUntil: org.paidUntil?.toISOString() ?? null },
            to: { subscriptionStatus: next.subscriptionStatus, paidUntil: next.paidUntil?.toISOString() ?? null },
            billingNotesChanged: (org.billingNotes ?? null) !== next.billingNotes,
          };
          break;
        }
      }

      await tx.platformAuditLog.create({
        data: platformAuditData({ actor: admin, action: platformAction, targetType: "Organization", targetId: id, organizationId: id, detail, ip }),
      });
      await tx.auditLog.create({
        data: supportAuditData({ organizationId: id, action: tenantAction, entityType: "Organization", entityId: id, detail }),
      });
    }, TX_OPTIONS);

    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
