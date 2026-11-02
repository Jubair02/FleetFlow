import { db } from "@/lib/db";
import { fail, ok, requireStaff } from "@/lib/api-helpers";
import { DEFAULT_TIMEZONE, startOfDayInTz } from "@/lib/timezone";
import type { CodSummary } from "@/lib/types-org";

const SHORT_WINDOW_DAYS = 30;

// GET /api/cod — cash on delivery: what each driver is holding, today's totals,
// short payments and recent handovers (admins and dispatchers).
export async function GET() {
  try {
    const user = await requireStaff();
    const organizationId = user.organizationId;
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const now = new Date();
    const today = startOfDayInTz(now, org?.timezone ?? DEFAULT_TIMEZONE);
    const shortSince = new Date(now.getTime() - SHORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [inHand, collectedToday, settledToday, open, collectedRecent, settlements] = await Promise.all([
      // cash collected but not yet handed over, per driver
      db.delivery.groupBy({
        by: ["codCollectedById"],
        where: { organizationId, codCollectedAt: { not: null }, codSettlementId: null },
        _sum: { codCollectedAmount: true },
        _count: { _all: true },
        _min: { codCollectedAt: true },
      }),
      db.delivery.aggregate({
        where: { organizationId, codCollectedAt: { gte: today } },
        _sum: { codCollectedAmount: true },
        _count: { _all: true },
      }),
      db.codSettlement.aggregate({ where: { organizationId, createdAt: { gte: today } }, _sum: { amount: true } }),
      // still to collect: COD deliveries that aren't finished
      db.delivery.aggregate({
        where: { organizationId, codAmount: { gt: 0 }, status: { notIn: ["DELIVERED", "CANCELLED", "FAILED"] } },
        _sum: { codAmount: true },
        _count: { _all: true },
      }),
      db.delivery.findMany({
        where: { organizationId, codCollectedAt: { gte: shortSince }, codAmount: { gt: 0 } },
        select: {
          id: true, trackingCode: true, recipientName: true, codAmount: true, codCollectedAmount: true, codCollectedAt: true,
          codCollectedBy: { select: { name: true } },
        },
        orderBy: { codCollectedAt: "desc" },
        take: 500,
      }),
      db.codSettlement.findMany({
        where: { organizationId },
        include: { driver: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    const driverIds = inHand.map((g) => g.codCollectedById).filter((id): id is string => !!id);
    const drivers = await db.user.findMany({
      where: { id: { in: driverIds }, organizationId },
      select: { id: true, name: true, active: true, driverProfile: { select: { phone: true } } },
    });
    const byId = new Map(drivers.map((d) => [d.id, d]));

    const body: CodSummary = {
      totals: {
        cashWithDrivers: inHand.reduce((s, g) => s + (g._sum.codCollectedAmount ?? 0), 0),
        collectedToday: collectedToday._sum.codCollectedAmount ?? 0,
        collectedTodayCount: collectedToday._count._all,
        settledToday: settledToday._sum.amount ?? 0,
        toCollect: open._sum.codAmount ?? 0,
        toCollectCount: open._count._all,
      },
      drivers: inHand
        .filter((g) => g.codCollectedById && byId.has(g.codCollectedById))
        .map((g) => {
          const d = byId.get(g.codCollectedById!)!;
          return {
            driverId: d.id,
            name: d.name,
            phone: d.driverProfile?.phone ?? null,
            active: d.active,
            cashInHand: g._sum.codCollectedAmount ?? 0,
            deliveries: g._count._all,
            oldestCollectedAt: g._min.codCollectedAt?.toISOString() ?? null,
          };
        })
        .sort((a, b) => b.cashInHand - a.cashInHand),
      short: collectedRecent
        .filter((d) => (d.codCollectedAmount ?? 0) < (d.codAmount ?? 0))
        .slice(0, 50)
        .map((d) => ({
          deliveryId: d.id,
          trackingCode: d.trackingCode,
          recipientName: d.recipientName,
          codAmount: d.codAmount ?? 0,
          collected: d.codCollectedAmount ?? 0,
          driverName: d.codCollectedBy?.name ?? null,
          collectedAt: d.codCollectedAt!.toISOString(),
        })),
      settlements: settlements.map((s) => ({
        id: s.id,
        driverName: s.driver.name,
        amount: s.amount,
        deliveryCount: s.deliveryCount,
        receivedByName: s.receivedByName,
        note: s.note,
        createdAt: s.createdAt.toISOString(),
      })),
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
