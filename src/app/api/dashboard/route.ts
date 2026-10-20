import { db } from "@/lib/db";
import { fail, ok, requireAdmin } from "@/lib/api-helpers";
import { isLateDelivery } from "@/lib/delivery";

// GET /api/dashboard — operations metrics for the admin dashboard
export async function GET() {
  try {
    const user = await requireAdmin();
    const orgId = user.organizationId;
    const DAY = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - 13 * DAY);
    since.setHours(0, 0, 0, 0);

    const [deliveries, drivers, vehicles, recentEvents] = await Promise.all([
      db.delivery.findMany({
        where: { organizationId: orgId },
        select: { status: true, priority: true, createdAt: true, expectedAt: true, completedAt: true, failureReason: true, trackingCode: true, recipientName: true },
      }),
      db.user.findMany({
        where: { organizationId: orgId, role: "DRIVER" },
        include: { driverProfile: true, assignments: { where: { active: true }, select: { id: true } } },
      }),
      db.vehicle.findMany({ where: { organizationId: orgId } }),
      db.deliveryEvent.findMany({
        where: { delivery: { organizationId: orgId } },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { delivery: { select: { trackingCode: true } } },
      }),
    ]);

    const byStatus = (s: string) => deliveries.filter((d) => d.status === s).length;
    const delivered = deliveries.filter((d) => d.status === "DELIVERED");
    const late = delivered.filter(isLateDelivery);

    // 14-day daily series
    const daily: { date: string; total: number; completed: number; failed: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * DAY);
      day.setHours(0, 0, 0, 0);
      const next = new Date(day.getTime() + DAY);
      const inDay = deliveries.filter((d) => d.createdAt >= day && d.createdAt < next);
      daily.push({
        date: day.toISOString().slice(0, 10),
        total: inDay.length,
        completed: inDay.filter((d) => d.status === "DELIVERED").length,
        failed: inDay.filter((d) => d.status === "FAILED").length,
      });
    }

    const statusBreakdown = ["CREATED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELLED"].map((s) => ({
      status: s,
      count: byStatus(s),
    }));

    const priorityBreakdown = ["URGENT", "HIGH", "NORMAL", "LOW"].map((p) => ({
      priority: p,
      count: deliveries.filter((d) => d.priority === p).length,
    }));

    // attention lists
    const failedIds = await db.delivery.findMany({
      where: { organizationId: orgId, status: "FAILED" },
      select: { id: true, trackingCode: true, recipientName: true, failureReason: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const urgentIds = await db.delivery.findMany({
      where: { organizationId: orgId, status: "CREATED", priority: { in: ["URGENT", "HIGH"] } },
      select: { id: true, trackingCode: true, recipientName: true, priority: true, expectedAt: true },
      orderBy: { expectedAt: "asc" },
      take: 5,
    });

    return ok({
      stats: {
        total: deliveries.length,
        pendingAssignment: byStatus("CREATED"),
        inProgress: byStatus("ASSIGNED") + byStatus("PICKED_UP") + byStatus("IN_TRANSIT"),
        completed: byStatus("DELIVERED"),
        failed: byStatus("FAILED"),
        cancelled: byStatus("CANCELLED"),
        activeDrivers: drivers.filter((d) => d.active && d.driverProfile && d.driverProfile.availability !== "OFF_DUTY").length,
        totalDrivers: drivers.length,
        vehiclesAttention: vehicles.filter((v) => v.status === "MAINTENANCE").length,
        vehiclesTotal: vehicles.length,
        onTimeRate: delivered.length ? Math.round(((delivered.length - late.length) / delivered.length) * 100) : null,
        lateCount: late.length,
      },
      daily,
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
        failedDeliveries: failedIds,
        pendingUrgent: urgentIds,
        maintenanceVehicles: vehicles
          .filter((v) => v.status !== "ACTIVE")
          .map((v) => ({ id: v.id, registrationNumber: v.registrationNumber, type: v.type, status: v.status, notes: v.notes })),
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
