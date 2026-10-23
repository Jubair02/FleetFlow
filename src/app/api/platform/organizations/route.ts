import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp, generateTempPassword } from "@/lib/account";
import { TX_OPTIONS } from "@/lib/delivery";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { listPrice } from "@/lib/plans";
import { platformAuditData, requirePlatformAdmin } from "@/lib/platform-auth";
import {
  ORG_EXPORT_CAP, ORG_PAGE_SIZE, createOrgSchemaFor, daysBefore, orgListQuery, parseRegisteredRange, toBillingCycle, paged, parseBody,
  parseQuery, startOfUtcMonth, supportAuditData,
} from "@/lib/platform-service";
import type { CreateOrgResult, OrgStatus, PlatformOrgList, PlatformOrgRow, PlatformOrgSummary, SubscriptionStatus } from "@/lib/platform-types";

// GET /api/platform/organizations?search=&status=&plan=&page=&pageSize=&subscription=&from=&to=&export=1
// → PlatformOrgList. ?export=1 returns every match (max ORG_EXPORT_CAP) as one page, with summary: null.
export async function GET(req: Request) {
  try {
    await requirePlatformAdmin();
    const q = parseQuery(orgListQuery, new URL(req.url).searchParams, [
      "search", "status", "plan", "page", "pageSize", "subscription", "from", "to", "export",
    ]);
    if (q.plan && !(await db.plan.findUnique({ where: { code: q.plan }, select: { code: true } }))) {
      throw new ApiError(400, "Unknown plan");
    }
    const registered = parseRegisteredRange(q.from, q.to);
    const exporting = !!q.export;
    const pageSize = exporting ? ORG_EXPORT_CAP : q.pageSize ?? ORG_PAGE_SIZE;
    const pageNo = exporting ? 1 : q.page;

    const where: Prisma.OrganizationWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.subscription ? { subscriptionStatus: q.subscription } : {}),
      ...(q.plan ? { plan: q.plan } : {}),
      ...(registered ? { createdAt: registered } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { id: { contains: q.search, mode: "insensitive" } },
              { contactEmail: { contains: q.search, mode: "insensitive" } },
              { users: { some: { role: "ADMIN", email: { contains: q.search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const now = new Date();
    const weekAgo = daysBefore(now, 7);
    const summaryQuery: Promise<PlatformOrgSummary | null> = exporting
      ? Promise.resolve(null)
      : Promise.all([
          db.organization.count(),
          db.organization.count({ where: { createdAt: { gte: weekAgo } } }),
          db.organization.count({ where: { status: "ACTIVE" } }),
          db.organization.count({ where: { status: "ACTIVE", createdAt: { gte: weekAgo } } }),
          db.user.count(),
          db.user.count({ where: { createdAt: { gte: weekAgo } } }),
          db.organization.count({ where: { subscriptionStatus: "ACTIVE" } }),
        ]).then(([totalOrganizations, newOrganizationsThisWeek, activeOrganizations, newActiveThisWeek, totalUsers, newUsersThisWeek, activeSubscriptions]) => ({
          totalOrganizations, newOrganizationsThisWeek, activeOrganizations, newActiveThisWeek, totalUsers, newUsersThisWeek, activeSubscriptions,
        }));

    const [total, orgs, summary] = await Promise.all([
      db.organization.count({ where }),
      db.organization.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, name: true, status: true, plan: true, subscriptionStatus: true, paidUntil: true, createdAt: true,
          billingCycle: true, subscriptionPriceBdt: true, contactEmail: true, planRecord: { select: { name: true, active: true } },
        },
      }),
      summaryQuery,
    ]);

    const ids = orgs.map((o) => o.id);
    const monthStart = startOfUtcMonth(now);
    const day30 = daysBefore(now, 30);
    const day60 = daysBefore(now, 60);
    const inPage = { organizationId: { in: ids } };
    // One groupBy per metric over this page's ids — never a query per organization.
    const [users, vehicles, deliveries, deliveriesMonth, deliveries30, deliveriesPrev30, audits] = ids.length
      ? await Promise.all([
          db.user.groupBy({ by: ["organizationId", "role", "active"], where: inPage, _count: { _all: true } }),
          db.vehicle.groupBy({ by: ["organizationId"], where: { ...inPage, status: { not: "INACTIVE" } }, _count: { _all: true } }),
          db.delivery.groupBy({ by: ["organizationId"], where: inPage, _count: { _all: true }, _max: { createdAt: true } }),
          db.delivery.groupBy({ by: ["organizationId"], where: { ...inPage, createdAt: { gte: monthStart } }, _count: { _all: true } }),
          db.delivery.groupBy({ by: ["organizationId"], where: { ...inPage, createdAt: { gte: day30 } }, _count: { _all: true } }),
          db.delivery.groupBy({ by: ["organizationId"], where: { ...inPage, createdAt: { gte: day60, lt: day30 } }, _count: { _all: true } }),
          db.auditLog.groupBy({ by: ["organizationId"], where: inPage, _max: { createdAt: true } }),
        ])
      : [[], [], [], [], [], [], []];

    const countBy = (rows: { organizationId: string | null; _count: { _all: number } }[]) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.organizationId) m.set(r.organizationId, (m.get(r.organizationId) ?? 0) + r._count._all);
      return m;
    };
    const vehiclesBy = countBy(vehicles);
    const monthBy = countBy(deliveriesMonth);
    const d30By = countBy(deliveries30);
    const prev30By = countBy(deliveriesPrev30);
    const deliveriesBy = new Map(deliveries.map((d) => [d.organizationId, d]));
    const auditsBy = new Map(audits.map((a) => [a.organizationId, a]));
    const userCount = (orgId: string, pick: (u: { role: string; active: boolean }) => boolean) =>
      users.filter((u) => u.organizationId === orgId && pick(u)).reduce((s, u) => s + u._count._all, 0);

    const latest = (...dates: (Date | null | undefined)[]) => {
      const ts = dates.filter((d): d is Date => !!d).map((d) => d.getTime());
      return ts.length ? new Date(Math.max(...ts)).toISOString() : null;
    };

    const items: PlatformOrgRow[] = orgs.map((o) => {
      const del = deliveriesBy.get(o.id);
      return {
        id: o.id,
        name: o.name,
        status: o.status as OrgStatus,
        plan: o.plan,
        planName: o.planRecord.name,
        subscriptionStatus: o.subscriptionStatus as SubscriptionStatus,
        paidUntil: o.paidUntil?.toISOString() ?? null,
        billingCycle: toBillingCycle(o.billingCycle),
        subscriptionPriceBdt: o.subscriptionPriceBdt,
        createdAt: o.createdAt.toISOString(),
        counts: {
          // Active accounts only (unchanged meaning); `users` below counts every account.
          admins: userCount(o.id, (u) => u.role === "ADMIN" && u.active),
          drivers: userCount(o.id, (u) => u.role === "DRIVER" && u.active),
          vehicles: vehiclesBy.get(o.id) ?? 0,
          deliveries: del?._count._all ?? 0,
          deliveriesThisMonth: monthBy.get(o.id) ?? 0,
        },
        lastActivityAt: latest(del?._max.createdAt, auditsBy.get(o.id)?._max.createdAt),
        contactEmail: o.contactEmail,
        planActive: o.planRecord.active,
        users: userCount(o.id, () => true),
        deliveries30d: d30By.get(o.id) ?? 0,
        deliveriesPrev30d: prev30By.get(o.id) ?? 0,
      };
    });

    const result: PlatformOrgList = { ...paged(items, total, pageNo, pageSize), summary };
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}

// POST /api/platform/organizations {companyName, adminName, adminEmail, plan, phone?} → CreateOrgResult
// `plan` must be an ACTIVE plan code; the monthly list price is snapshotted.
// The temporary password is returned once and never logged.
export async function POST(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const body = await readJson<unknown>(req);
    const activePlans = await db.plan.findMany({ where: { active: true } });
    const data = parseBody(createOrgSchemaFor(activePlans.map((p) => p.code)), body);
    const plan = activePlans.find((p) => p.code === data.plan)!;
    // New accounts start on the monthly cycle at today's list price (null = free).
    const subscriptionPriceBdt = listPrice(plan, "MONTHLY");

    const temporaryPassword = generateTempPassword();
    // Hash outside the transaction so the connection isn't held during scrypt.
    const passwordHash = await hashPassword(temporaryPassword);

    let organizationId: string;
    try {
      organizationId = await db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: data.companyName,
            plan: plan.code,
            billingCycle: "MONTHLY",
            subscriptionPriceBdt,
            planAssignedAt: new Date(),
            phone: data.phone || null,
            contactEmail: data.adminEmail,
            timezone: DEFAULT_TIMEZONE,
            status: "ACTIVE",
            subscriptionStatus: "TRIAL",
          },
        });
        const user = await tx.user.create({
          data: {
            organizationId: org.id,
            name: data.adminName,
            email: data.adminEmail,
            passwordHash,
            role: "ADMIN",
            mustChangePassword: true,
          },
        });
        const detail = { companyName: data.companyName, adminEmail: data.adminEmail, plan: plan.code, billingCycle: "MONTHLY", priceBdt: subscriptionPriceBdt };
        await tx.auditLog.create({
          data: supportAuditData({ organizationId: org.id, action: "ORGANIZATION_CREATED", entityType: "Organization", entityId: org.id, detail }),
        });
        await tx.platformAuditLog.create({
          data: platformAuditData({
            actor: admin, action: "ORG_CREATED", targetType: "Organization", targetId: org.id, organizationId: org.id,
            detail: { ...detail, adminUserId: user.id }, ip: clientIp(req),
          }),
        });
        return org.id;
      }, TX_OPTIONS);
    } catch (e) {
      // Emails are globally unique; don't reveal where the account lives.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(409, "This email can't be used for a new account");
      }
      throw e;
    }

    const result: CreateOrgResult = { organizationId, adminEmail: data.adminEmail, temporaryPassword };
    return ok(result, 201);
  } catch (e) {
    return fail(e);
  }
}
