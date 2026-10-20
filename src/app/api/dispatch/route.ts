import { db } from "@/lib/db";
import { fail, ok, requireAdmin } from "@/lib/api-helpers";
import { toDeliveryDTO, toAssignmentDTO } from "@/lib/serializers";

// GET /api/dispatch — the dispatch board: unassigned queue, active
// assignments, and driver/vehicle availability for the assign dialog.
export async function GET() {
  try {
    const user = await requireAdmin();
    const orgId = user.organizationId;

    const [unassigned, activeAssignments, drivers, vehicles] = await Promise.all([
      db.delivery.findMany({
        where: { organizationId: orgId, status: { in: ["CREATED", "FAILED"] } },
        orderBy: [{ priority: "desc" }, { expectedAt: "asc" }],
        include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } },
      }),
      db.assignment.findMany({
        where: { active: true, delivery: { organizationId: orgId } },
        orderBy: { assignedAt: "desc" },
        include: {
          driver: true,
          vehicle: true,
          delivery: { include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } } },
        },
      }),
      db.user.findMany({
        where: { organizationId: orgId, role: "DRIVER" },
        include: { driverProfile: true },
        orderBy: { name: "asc" },
      }),
      db.vehicle.findMany({
        where: { organizationId: orgId },
        include: { _count: { select: { assignments: { where: { active: true } } } } },
        orderBy: { registrationNumber: "asc" },
      }),
    ]);

    const activeJobCounts = await db.assignment.groupBy({
      by: ["driverId"],
      where: { active: true, driver: { organizationId: orgId } },
      _count: true,
    });
    const jobMap = new Map(activeJobCounts.map((c) => [c.driverId, c._count]));

    return ok({
      unassigned: unassigned.map((d) => toDeliveryDTO(d, false)),
      assignments: activeAssignments.map((a) => ({
        ...toAssignmentDTO(a),
        delivery: toDeliveryDTO(a.delivery, false),
      })),
      drivers: drivers
        .filter((d) => d.driverProfile)
        .map((d) => ({
          id: d.id,
          name: d.name,
          active: d.active,
          availability: d.driverProfile!.availability,
          maxActiveJobs: d.driverProfile!.maxActiveJobs,
          activeJobs: jobMap.get(d.id) ?? 0,
        })),
      vehicles: vehicles.map((v) => ({
        id: v.id,
        registrationNumber: v.registrationNumber,
        type: v.type,
        capacity: v.capacity || "",
        status: v.status,
        activeJobs: v._count.assignments,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
