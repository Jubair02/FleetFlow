import { db } from "@/lib/db";
import { fail, localDayKey, ok, parseTzOffset, requireAdmin } from "@/lib/api-helpers";
import { onTimeRateFromCounts, summarizeStatuses } from "@/lib/report-metrics";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 14;

// GET /api/dashboard?tz= — operations metrics for the admin dashboard
// `tz` = viewer's getTimezoneOffset(); the daily chart is keyed by their local date.
export async function GET(req: Request) {
  try {
    const user = await requireAdmin();
    const orgId = user.organizationId;
    const tz = parseTzOffset(new URL(req.url).searchParams.get("tz"));

    // Last 14 local days, oldest first; window starts at local midnight of the first day.
    const todayKey = localDayKey(new Date(), tz);
    const todayStart = Date.parse(`${todayKey}T00:00:00.000Z`) + tz * 60_000;
    const dayKeys = Array.from({ length: CHART_DAYS }, (_, i) =>
      new Date(Date.parse(`${todayKey}T00:00:00.000Z`) - (CHART_DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10)
    );
    const windowStart = new Date(todayStart - (CHART_DAYS - 1) * DAY_MS);

    const orgDeliveries = { organizationId: orgId };
    const urgentPendingWhere = { ...orgDeliveries, status: "CREATED", priority: { in: ["URGENT", "HIGH"] } };

    const [
      statusCounts,
      priorityCounts,
      lateCount,
      onTimeEligible,
      deliveredWithoutDeadline,
      createdInWindow,
      completedInWindow,
      failedEventsInWindow,
      drivers,
      vehicles,
      recentEvents,
      failedList,
      urgentList,
      pendingUrgentCount,
    ] = await Promise.all([
      db.delivery.groupBy({ by: ["status"], where: orgDeliveries, _count: { _all: true } }),
      db.delivery.groupBy({ by: ["priority"], where: orgDeliveries, _count: { _all: true } }),
      // On-time rate (see src/lib/report-metrics.ts): on-time ÷ delivered WITH a deadline.
      // Deliveries without expectedAt/completedAt are excluded, never counted as on time.
      db.delivery.count({
        where: {
          ...orgDeliveries,
          status: "DELIVERED",
          expectedAt: { not: null },
          completedAt: { not: null, gt: db.delivery.fields.expectedAt },
        },
      }),
      db.delivery.count({
        where: { ...orgDeliveries, status: "DELIVERED", expectedAt: { not: null }, completedAt: { not: null } },
      }),
      db.delivery.count({
        where: { ...orgDeliveries, status: "DELIVERED", OR: [{ expectedAt: null }, { completedAt: null }] },
      }),
      db.delivery.findMany({
        where: { ...orgDeliveries, createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      db.delivery.findMany({
        where: { ...orgDeliveries, status: "DELIVERED", completedAt: { gte: windowStart } },
        select: { completedAt: true },
      }),
      db.deliveryEvent.findMany({
        where: { eventType: "FAILED", createdAt: { gte: windowStart }, delivery: orgDeliveries },
        select: { createdAt: true },
      }),
      db.user.findMany({
        where: { organizationId: orgId, role: "DRIVER" },
        include: { driverProfile: true, assignments: { where: { active: true }, select: { id: true } } },
        orderBy: { name: "asc" },
      }),
      db.vehicle.findMany({ where: { organizationId: orgId }, orderBy: { registrationNumber: "asc" } }),
      db.deliveryEvent.findMany({
        where: { delivery: orgDeliveries },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 12,
        include: { delivery: { select: { trackingCode: true } } },
      }),
      db.delivery.findMany({
        where: { ...orgDeliveries, status: "FAILED" },
        select: { id: true, trackingCode: true, recipientName: true, failureReason: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
      }),
      db.delivery.findMany({
        where: urgentPendingWhere,
        select: { id: true, trackingCode: true, recipientName: true, priority: true, expectedAt: true },
        orderBy: [{ expectedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: 5,
      }),
      db.delivery.count({ where: urgentPendingWhere }),
    ]);

    const byStatus = (s: string) => statusCounts.find((c) => c.status === s)?._count._all ?? 0;
    const counts = summarizeStatuses(statusCounts.map((c) => ({ status: c.status, count: c._count._all })));

    // 14-day daily series keyed by the viewer's local date
    const dailyMap = new Map(dayKeys.map((date) => [date, { date, total: 0, completed: 0, failed: 0 }]));
    for (const d of createdInWindow) {
      const cur = dailyMap.get(localDayKey(d.createdAt, tz));
      if (cur) cur.total++;
    }
    for (const d of completedInWindow) {
      const cur = d.completedAt ? dailyMap.get(localDayKey(d.completedAt, tz)) : undefined;
      if (cur) cur.completed++;
    }
    for (const e of failedEventsInWindow) {
      const cur = dailyMap.get(localDayKey(e.createdAt, tz));
      if (cur) cur.failed++;
    }

    const statusBreakdown = ["CREATED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELLED"].map((s) => ({
      status: s,
      count: byStatus(s),
    }));

    const priorityBreakdown = ["URGENT", "HIGH", "NORMAL", "LOW"].map((p) => ({
      priority: p,
      count: priorityCounts.find((c) => c.priority === p)?._count._all ?? 0,
    }));

    const attentionVehicles = vehicles.filter((v) => v.status !== "ACTIVE");

    return ok({
      stats: {
        total: counts.total,
        pendingAssignment: counts.pendingDispatch,
        inProgress: counts.inProgress,
        completed: counts.delivered,
        failed: counts.failed,
        cancelled: counts.cancelled,
        activeDrivers: drivers.filter((d) => d.active && d.driverProfile && d.driverProfile.availability !== "OFF_DUTY").length,
        totalDrivers: drivers.length,
        vehiclesAttention: attentionVehicles.length,
        vehiclesTotal: vehicles.length,
        onTimeRate: onTimeRateFromCounts(lateCount, onTimeEligible),
        lateCount,
        onTimeEligible,
        deliveredWithoutDeadline,
      },
      daily: Array.from(dailyMap.values()),
      statusBreakdown,
      priorityBreakdown,
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        note: e.note,
        actorName: e.actorName,
        createdAt: e.createdAt.toISOString(),
        trackingCode: e.delivery.trackingCode,
        deliveryId: e.deliveryId,
      })),
      attention: {
        failedCount: byStatus("FAILED"),
        pendingUrgentCount,
        failedDeliveries: failedList.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
        pendingUrgent: urgentList.map((d) => ({ ...d, expectedAt: d.expectedAt?.toISOString() ?? null })),
        maintenanceVehicles: attentionVehicles.map((v) => ({
          id: v.id,
          registrationNumber: v.registrationNumber,
          type: v.type,
          status: v.status,
          notes: v.notes,
        })),
      },
      driverWorkload: drivers
        .filter((d) => d.driverProfile)
        .map((d) => ({
          id: d.id,
          name: d.name,
          active: d.active,
          availability: d.driverProfile!.availability,
          activeJobs: d.assignments.length,
          maxActiveJobs: d.driverProfile!.maxActiveJobs,
        })),
    });
  } catch (e) {
    return fail(e);
  }
}
