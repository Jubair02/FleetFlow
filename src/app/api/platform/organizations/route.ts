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
  ORG_PAGE_SIZE, createOrgSchemaFor, orgListQuery, toBillingCycle, paged, parseBody, parseQuery, startOfUtcMonth, supportAuditData,
} from "@/lib/platform-service";
import type { CreateOrgResult, OrgStatus, PlatformOrgRow, SubscriptionStatus } from "@/lib/platform-types";

// GET /api/platform/organizations?search=&status=&plan=&page=
export async function GET(req: Request) {
  try {
    await requirePlatformAdmin();
    const q = parseQuery(orgListQuery, new URL(req.url).searchParams, ["search", "status", "plan", "page"]);
    if (q.plan && !(await db.plan.findUnique({ where: { code: q.plan }, select: { code: true } }))) {
      throw new ApiError(400, "Unknown plan");
    }

    const where: Prisma.OrganizationWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.plan ? { plan: q.plan } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { id: { contains: q.search, mode: "insensitive" } },
              { contactEmail: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, orgs] = await Promise.all([
      db.organization.count({ where }),
      db.organization.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * ORG_PAGE_SIZE,
        take: ORG_PAGE_SIZE,
        select: {
          id: true, name: true, status: true, plan: true, subscriptionStatus: true, paidUntil: true, createdAt: true,
          billingCycle: true, subscriptionPriceBdt: true, planRecord: { select: { name: true } },
        },
      }),
    ]);

    const ids = orgs.map((o) => o.id);
    const monthStart = startOfUtcMonth(new Date());
    const inPage = { organizationId: { in: ids } };
    const [users, vehicles, deliveries, deliveriesMonth, audits] = ids.length
      ? await Promise.all([
          db.user.groupBy({ by: ["organizationId", "role"], where: { ...inPage, active: true }, _count: { _all: true } }),
          db.vehicle.groupBy({ by: ["organizationId"], where: { ...inPage, status: { not: "INACTIVE" } }, _count: { _all: true } }),
          db.delivery.groupBy({ by: ["organizationId"], where: inPage, _count: { _all: true }, _max: { createdAt: true } }),
          db.delivery.groupBy({ by: ["organizationId"], where: { ...inPage, createdAt: { gte: monthStart } }, _count: { _all: true } }),
          db.auditLog.groupBy({ by: ["organizationId"], where: inPage, _max: { createdAt: true } }),
        ])
      : [[], [], [], [], []];

    const latest = (...dates: (Date | null | undefined)[]) => {
      const ts = dates.filter((d): d is Date => !!d).map((d) => d.getTime());
      return ts.length ? new Date(Math.max(...ts)).toISOString() : null;
    };

    const items: PlatformOrgRow[] = orgs.map((o) => {
      const del = deliveries.find((d) => d.organizationId === o.id);
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
          admins: users.find((u) => u.organizationId === o.id && u.role === "ADMIN")?._count._all ?? 0,
          drivers: users.find((u) => u.organizationId === o.id && u.role === "DRIVER")?._count._all ?? 0,
          vehicles: vehicles.find((v) => v.organizationId === o.id)?._count._all ?? 0,
          deliveries: del?._count._all ?? 0,
          deliveriesThisMonth: deliveriesMonth.find((d) => d.organizationId === o.id)?._count._all ?? 0,
        },
        lastActivityAt: latest(del?._max.createdAt, audits.find((a) => a.organizationId === o.id)?._max.createdAt),
      };
    });

    return ok(paged(items, total, q.page, ORG_PAGE_SIZE));
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
