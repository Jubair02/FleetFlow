import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-helpers";
import { table } from "@/lib/delivery";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { lastDayKeys, lastMonthKeys, startOfUtcDay, startOfUtcMonth } from "@/lib/platform-service";
import type { PlatformOverview } from "@/lib/platform-types";

type Bucket = { k: string; n: number };

// GET /api/platform/overview — cross-tenant aggregates (real data, UTC buckets).
export async function GET() {
  try {
    await requirePlatformAdmin();
    const now = new Date();
    const monthStart = startOfUtcMonth(now);
    const twelveMonthsAgo = startOfUtcMonth(now, 11);
    const thirtyDaysAgo = startOfUtcDay(now, 29);

    const [
      orgTotal, orgByStatus, orgByPlan, orgBySub,
      usersByRole, inactiveUsers, vehicles,
      deliveryTotal, deliveriesThisMonth, deliveriesByStatus,
      orgMonthly, deliveryMonthly, deliveryDaily, top,
    ] = await Promise.all([
      db.organization.count(),
      db.organization.groupBy({ by: ["status"], _count: { _all: true } }),
      db.organization.groupBy({ by: ["plan"], _count: { _all: true } }),
      db.organization.groupBy({ by: ["subscriptionStatus"], _count: { _all: true } }),
      db.user.groupBy({ by: ["role"], _count: { _all: true } }),
      db.user.count({ where: { active: false } }),
      db.vehicle.count(),
      db.delivery.count(),
      db.delivery.count({ where: { createdAt: { gte: monthStart } } }),
      db.delivery.groupBy({ by: ["status"], _count: { _all: true } }),
      // "createdAt" is timestamp(3) without time zone holding UTC, so date_trunc buckets are UTC.
      db.$queryRaw<Bucket[]>`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS k, count(*)::int AS n
        FROM ${table("Organization")} WHERE "createdAt" >= ${twelveMonthsAgo} GROUP BY 1`,
      db.$queryRaw<Bucket[]>`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS k, count(*)::int AS n
        FROM ${table("Delivery")} WHERE "createdAt" >= ${twelveMonthsAgo} GROUP BY 1`,
      db.$queryRaw<Bucket[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS k, count(*)::int AS n
        FROM ${table("Delivery")} WHERE "createdAt" >= ${thirtyDaysAgo} GROUP BY 1`,
      db.delivery.groupBy({
        by: ["organizationId"],
        where: { createdAt: { gte: monthStart } },
        _count: { organizationId: true },
        orderBy: { _count: { organizationId: "desc" } },
        take: 5,
      }),
    ]);

    const topOrgs = top.length
      ? await db.organization.findMany({ where: { id: { in: top.map((t) => t.organizationId) } }, select: { id: true, name: true } })
      : [];
    const topNames = new Map(topOrgs.map((o) => [o.id, o.name]));
    const toMap = (rows: Bucket[]) => new Map(rows.map((r) => [r.k, Number(r.n)]));
    const orgM = toMap(orgMonthly);
    const delM = toMap(deliveryMonthly);
    const delD = toMap(deliveryDaily);
    const statusCount = (s: string) => orgByStatus.find((r) => r.status === s)?._count._all ?? 0;
    const roleCount = (r: string) => usersByRole.find((x) => x.role === r)?._count._all ?? 0;

    const body: PlatformOverview = {
      organizations: {
        total: orgTotal,
        active: statusCount("ACTIVE"),
        suspended: statusCount("SUSPENDED"),
        byPlan: orgByPlan.map((r) => ({ plan: r.plan, count: r._count._all })).sort((a, b) => b.count - a.count),
        bySubscription: orgBySub.map((r) => ({ status: r.subscriptionStatus, count: r._count._all })).sort((a, b) => b.count - a.count),
      },
      users: {
        total: usersByRole.reduce((s, r) => s + r._count._all, 0),
        admins: roleCount("ADMIN"),
        drivers: roleCount("DRIVER"),
        inactive: inactiveUsers,
      },
      vehicles,
      deliveries: {
        total: deliveryTotal,
        thisMonth: deliveriesThisMonth,
        byStatus: deliveriesByStatus.map((r) => ({ status: r.status, count: r._count._all })).sort((a, b) => b.count - a.count),
      },
      monthly: lastMonthKeys(now, 12).map((month) => ({ month, organizations: orgM.get(month) ?? 0, deliveries: delM.get(month) ?? 0 })),
      daily: lastDayKeys(now, 30).map((date) => ({ date, deliveries: delD.get(date) ?? 0 })),
      topOrganizations: top.map((t) => ({
        id: t.organizationId,
        name: topNames.get(t.organizationId) ?? "Unknown organization",
        deliveriesThisMonth: t._count.organizationId,
      })),
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
