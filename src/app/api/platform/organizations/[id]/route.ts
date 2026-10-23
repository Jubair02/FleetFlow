import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { table, TX_OPTIONS } from "@/lib/delivery";
import { getUsage, listPrice, toPlanDefinition } from "@/lib/plans";
import { platformAuditData, requirePlatformAdmin } from "@/lib/platform-auth";
import {
  ORG_DELETE_TX_OPTIONS, PROFILE_UPDATED_NOTE, REACTIVATION_DATA, USER_ROW_SELECT, assertCanDelete, assertCanReactivate, assertCanSuspend, checkSetPlan,
  daysBefore, deleteOrgData, deleteOrgSchema, orgActionSchema, orgDeletionWhere, orgSessionsWhere, parseBody, parsePaidUntil, profileChanges, successRate,
  supportAuditData, suspensionData, toAuditRow, toBillingCycle, toUserRow,
} from "@/lib/platform-service";
import { deletePodFile } from "@/lib/storage";
import type { OrgDeleteResult, OrgStatus, PlatformOrgDetail, SubscriptionStatus } from "@/lib/platform-types";

type Params = { params: Promise<{ id: string }> };

const MAX_USERS = 500;

// GET /api/platform/organizations/[id] → PlatformOrgDetail
export async function GET(_req: Request, { params }: Params) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const org = await db.organization.findUnique({ where: { id }, include: { planRecord: true } });
    if (!org) throw new ApiError(404, "Organization not found");
    const planDetail = toPlanDefinition(org.planRecord);
    const billingCycle = toBillingCycle(org.billingCycle);

    const since30d = daysBefore(new Date(), 30);
    const [usage, users, activity, actions, roleCounts, statusCounts] = await Promise.all([
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
      // Every account (active or not) by role — not capped like `users`.
      db.user.groupBy({ by: ["role"], where: { organizationId: org.id }, _count: { _all: true } }),
      db.delivery.groupBy({ by: ["status"], where: { organizationId: org.id, createdAt: { gte: since30d } }, _count: { _all: true } }),
    ]);

    const roleCount = (role: string) => roleCounts.find((r) => r.role === role)?._count._all ?? 0;
    const statusCount = (status: string) => statusCounts.find((r) => r.status === status)?._count._all ?? 0;
    const delivered30d = statusCount("DELIVERED");
    const failed30d = statusCount("FAILED");

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
        billingCycle,
        subscriptionPriceBdt: org.subscriptionPriceBdt,
        planAssignedAt: org.planAssignedAt.toISOString(),
        phone: org.phone,
        contactEmail: org.contactEmail,
        address: org.address,
        timezone: org.timezone,
        createdAt: org.createdAt.toISOString(),
        defaultPickupAddress: org.defaultPickupAddress,
      },
      usage,
      stats: {
        users: { admins: roleCount("ADMIN"), drivers: roleCount("DRIVER"), total: roleCounts.reduce((n, r) => n + r._count._all, 0) },
        deliveries30d: statusCounts.reduce((n, r) => n + r._count._all, 0),
        delivered30d,
        failed30d,
        successRate30d: successRate(delivered30d, failed30d),
      },
      planDetail,
      currentListPriceBdt: listPrice(planDetail, billingCycle),
      limits: planDetail.limits,
      users: users.map(toUserRow),
      recentActivity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      platformActions: actions.map((a) => toAuditRow(a, names)),
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/platform/organizations/[id] — OrgAction → { success } ("update-profile" adds { changed })
// Every write is scoped to this organization (where: { id } / { organizationId: id }).
export async function PATCH(req: Request, { params }: Params) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await params;
    const input = parseBody(orgActionSchema, await readJson<unknown>(req));
    const ip = clientIp(req);

    const changed = await db.$transaction(async (tx): Promise<string[] | undefined> => {
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
          const row = await tx.plan.findUnique({ where: { code: input.plan } });
          const target = row ? toPlanDefinition(row) : null;
          // Only ACTIVE plans can be newly assigned; snapshot = priceBdt ?? list price for the cycle.
          const { snapshot } = checkSetPlan(org, target, input.billingCycle, input.priceBdt);
          const listPriceBdt = target ? listPrice(target, input.billingCycle) : null;
          await tx.organization.update({
            where: { id },
            data: { plan: input.plan, billingCycle: input.billingCycle, subscriptionPriceBdt: snapshot, planAssignedAt: new Date() },
          });
          platformAction = "PLAN_CHANGED";
          tenantAction = "PLAN_CHANGED";
          detail = {
            from: { plan: org.plan, billingCycle: org.billingCycle, priceBdt: org.subscriptionPriceBdt },
            to: { plan: input.plan, billingCycle: input.billingCycle, priceBdt: snapshot },
            listPriceBdt,
            negotiated: snapshot !== listPriceBdt,
          };
          break;
        }
        case "update-profile": {
          const data = profileChanges(org, input);
          const fields = Object.keys(data);
          // Nothing differs → no write and no audit noise.
          if (fields.length === 0) return [];
          await tx.organization.update({ where: { id }, data });
          platformAction = "ORG_PROFILE_UPDATED";
          // Same tenant action as the company's own settings page; field names only, never values.
          tenantAction = "ORG_SETTINGS_UPDATED";
          detail = { note: PROFILE_UPDATED_NOTE, changed: fields };
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
      return input.action === "update-profile" ? (detail.changed as string[]) : undefined;
    }, TX_OPTIONS);

    return ok(changed ? { success: true, changed } : { success: true });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/platform/organizations/[id] { confirmName } → OrgDeleteResult
// PERMANENT. Only a SUSPENDED organization, confirmed by its exact name. Every delete is
// scoped to this organization id (see orgDeletionWhere); the platform audit row survives.
export async function DELETE(req: Request, { params }: Params) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await params;
    const { confirmName } = parseBody(deleteOrgSchema, await readJson<unknown>(req));
    const ip = clientIp(req);

    // Pre-checks outside the transaction for fast, clear errors; repeated under the lock below.
    const existing = await db.organization.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
    if (!existing) throw new ApiError(404, "Organization not found");
    assertCanDelete(existing, confirmName);

    const { counts, fileKeys } = await db.$transaction(async (tx) => {
      // Serialize with every other platform action on this organization, and block new
      // rows that reference it, until the deletion commits.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ${table("Organization")} WHERE id = ${id} FOR UPDATE`;
      if (!locked.length) throw new ApiError(404, "Organization not found");
      const org = await tx.organization.findUniqueOrThrow({ where: { id } });
      assertCanDelete(org, confirmName);

      // File keys must be read before their rows go; files are removed only after commit.
      const pods = await tx.proofOfDelivery.findMany({ where: orgDeletionWhere(id).proofOfDelivery, select: { fileKey: true } });
      const counts = await deleteOrgData(tx, id);

      // PlatformAuditLog has no FK to Organization, so this record outlives the organization.
      await tx.platformAuditLog.create({
        data: platformAuditData({
          actor: admin,
          action: "ORG_DELETED",
          targetType: "Organization",
          targetId: id,
          organizationId: id,
          detail: { name: org.name, id: org.id, plan: org.plan, status: org.status, subscriptionStatus: org.subscriptionStatus, counts },
          ip,
        }),
      });
      return { counts, fileKeys: pods.map((p) => p.fileKey) };
    }, ORG_DELETE_TX_OPTIONS);

    // Best effort, after commit: a leftover file is harmless, a rolled-back row pointing at a deleted file is not.
    await removePodFiles(fileKeys);

    const body: OrgDeleteResult = { deleted: true, counts };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}

const POD_DELETE_BATCH = 20;

async function removePodFiles(fileKeys: string[]): Promise<void> {
  for (let i = 0; i < fileKeys.length; i += POD_DELETE_BATCH) {
    await Promise.all(
      fileKeys.slice(i, i + POD_DELETE_BATCH).map((key) =>
        deletePodFile(key).catch((err: unknown) => console.error("[platform] could not remove proof-of-delivery file after organization deletion:", key, err))
      )
    );
  }
}
