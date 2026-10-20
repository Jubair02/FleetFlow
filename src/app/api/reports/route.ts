import { db } from "@/lib/db";
import { fail, ok, requireAdmin } from "@/lib/api-helpers";
import { isLateDelivery } from "@/lib/delivery";
import type { Prisma } from "@prisma/client";

// GET /api/reports?from=&to=&driverId=&vehicleId=&status=&priority=
// Delivery history with completion / on-time / late metrics + per-driver breakdown.
export async function GET(req: Request) {
  try {
    const user = await requireAdmin();
    const url = new URL(req.url);
    const q = (k: string) => url.searchParams.get(k)?.trim() || "";

    const where: Prisma.DeliveryWhereInput = { organizationId: user.organizationId };
    if (q("from") || q("to")) {
      where.createdAt = {};
      if (q("from")) where.createdAt.gte = new Date(`${q("from")}T00:00:00.000`);
      if (q("to")) where.createdAt.lte = new Date(`${q("to")}T23:59:59.999`);
    }
    if (q("driverId")) where.assignments = { some: { driverId: q("driverId") } };
    if (q("vehicleId")) where.assignments = { some: { vehicleId: q("vehicleId") } };
    if (q("status")) where.status = q("status");
    if (q("priority")) where.priority = q("priority");

    const deliveries = await db.delivery.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        assignments: { include: { driver: true, vehicle: true } },
      },
    });

    const completed = deliveries.filter((d) => d.status === "DELIVERED");
    const failed = deliveries.filter((d) => d.status === "FAILED");
    const cancelled = deliveries.filter((d) => d.status === "CANCELLED");
    const late = completed.filter(isLateDelivery);
    const considered = deliveries.length - cancelled.length;
    const avgHours = completed.length
      ? completed.reduce((acc, d) => acc + (d.completedAt!.getTime() - d.createdAt.getTime()) / 36e5, 0) / completed.length
      : null;

    // per-driver breakdown
    const driverStats = new Map<string, { driverId: string; driverName: string; total: number; completed: number; failed: number; late: number }>();
    for (const d of deliveries) {
      for (const a of d.assignments) {
        const cur = driverStats.get(a.driverId) ?? { driverId: a.driverId, driverName: a.driver.name, total: 0, completed: 0, failed: 0, late: 0 };
        cur.total++;
        if (d.status === "DELIVERED") {
          cur.completed++;
          if (isLateDelivery(d)) cur.late++;
        }
        if (d.status === "FAILED") cur.failed++;
        driverStats.set(a.driverId, cur);
      }
    }

    // daily series over the filtered range (capped at 30 days)
    const dates = deliveries.map((d) => d.createdAt.toISOString().slice(0, 10));
    const dailyMap = new Map<string, { date: string; total: number; completed: number; failed: number }>();
    for (const date of dates) {
      const cur = dailyMap.get(date) ?? { date, total: 0, completed: 0, failed: 0 };
      cur.total++;
      dailyMap.set(date, cur);
    }
    for (const d of deliveries) {
      const date = d.createdAt.toISOString().slice(0, 10);
      const cur = dailyMap.get(date);
      if (!cur) continue;
      if (d.status === "DELIVERED") cur.completed++;
      if (d.status === "FAILED") cur.failed++;
    }

    return ok({
      summary: {
        total: deliveries.length,
        completed: completed.length,
        failed: failed.length,
        cancelled: cancelled.length,
        completionRate: considered ? Math.round((completed.length / considered) * 100) : null,
        onTimeCount: completed.length - late.length,
        lateCount: late.length,
        onTimeRate: completed.length ? Math.round(((completed.length - late.length) / completed.length) * 100) : null,
        avgCompletionHours: avgHours ? Math.round(avgHours * 10) / 10 : null,
      },
      driverBreakdown: Array.from(driverStats.values()).sort((a, b) => b.total - a.total),
      daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      items: deliveries.slice(0, 200).map((d) => {
        const a = d.assignments[d.assignments.length - 1];
        return {
          id: d.id,
          trackingCode: d.trackingCode,
          recipientName: d.recipientName,
          status: d.status,
          priority: d.priority,
          createdAt: d.createdAt.toISOString(),
          expectedAt: d.expectedAt?.toISOString() ?? null,
          completedAt: d.completedAt?.toISOString() ?? null,
          isLate: isLateDelivery(d),
          failureReason: d.failureReason,
          driverName: a?.driver.name ?? null,
          vehicleRegistration: a?.vehicle?.registrationNumber ?? null,
        };
      }),
    });
  } catch (e) {
    return fail(e);
  }
}
