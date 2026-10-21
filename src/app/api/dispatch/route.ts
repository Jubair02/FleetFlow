import { db } from "@/lib/db";
import { fail, ok, requireAdmin } from "@/lib/api-helpers";
import { toDeliveryDTO, toAssignmentDTO } from "@/lib/serializers";
import { PRIORITIES } from "@/lib/constants";
import type { Prisma } from "@prisma/client";

// Max deliveries shown in the unassigned queue.
const QUEUE_LIMIT = 500;

// Priority is stored as a string, so the DB would sort it alphabetically.
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const rankOf = (p: string) => PRIORITY_RANK[p] ?? PRIORITIES.length;

type QueueItem = { priority: string; expectedAt: Date | null; createdAt: Date; id: string };

/** URGENT > HIGH > NORMAL > LOW, then soonest expectedAt (no deadline last), then oldest first. */
function compareQueue(a: QueueItem, b: QueueItem): number {
  const byRank = rankOf(a.priority) - rankOf(b.priority);
  if (byRank) return byRank;
  if (a.expectedAt && b.expectedAt) {
    const byDue = a.expectedAt.getTime() - b.expectedAt.getTime();
    if (byDue) return byDue;
  } else if (a.expectedAt || b.expectedAt) {
    return a.expectedAt ? -1 : 1;
  }
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  return byCreated || a.id.localeCompare(b.id);
}

// GET /api/dispatch — the dispatch board: unassigned queue, active
// assignments, and driver/vehicle availability for the assign dialog.
export async function GET() {
  try {
    const user = await requireAdmin();
    const orgId = user.organizationId;

    const deliveryInclude = {
      assignments: { where: { active: true }, include: { driver: true, vehicle: true } },
      _count: { select: { pods: true } },
    } satisfies Prisma.DeliveryInclude;

    // One bounded query per priority bucket (each already in queue order), so the
    // cap never drops an urgent job in favour of older low-priority ones.
    const queueWhere = { organizationId: orgId, status: { in: ["CREATED", "FAILED"] } } satisfies Prisma.DeliveryWhereInput;
    const queueOrder: Prisma.DeliveryOrderByWithRelationInput[] = [
      { expectedAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ];
    const priorityFilters: Prisma.DeliveryWhereInput[] = [
      ...PRIORITIES.map((p) => ({ priority: p })),
      { priority: { notIn: [...PRIORITIES] } },
    ];

    const [queueBuckets, activeAssignments, drivers, vehicles] = await Promise.all([
      Promise.all(
        priorityFilters.map((pf) =>
          db.delivery.findMany({
            where: { ...queueWhere, ...pf },
            orderBy: queueOrder,
            take: QUEUE_LIMIT,
            include: deliveryInclude,
          })
        )
      ),
      db.assignment.findMany({
        where: { active: true, delivery: { organizationId: orgId } },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        include: {
          driver: true,
          vehicle: true,
          delivery: { include: deliveryInclude },
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

    const unassigned = queueBuckets.flat().sort(compareQueue).slice(0, QUEUE_LIMIT);

    const jobMap = new Map<string, number>();
    // Driver currently holding each vehicle (from its active assignment)
    const vehicleDriver = new Map<string, { id: string; name: string }>();
    for (const a of activeAssignments) {
      jobMap.set(a.driverId, (jobMap.get(a.driverId) ?? 0) + 1);
      if (!vehicleDriver.has(a.vehicleId)) vehicleDriver.set(a.vehicleId, { id: a.driverId, name: a.driver.name });
    }

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
      vehicles: vehicles.map((v) => {
        const current = vehicleDriver.get(v.id) ?? null;
        return {
          id: v.id,
          registrationNumber: v.registrationNumber,
          type: v.type,
          capacity: v.capacity || "",
          status: v.status,
          activeJobs: v._count.assignments,
          currentDriverId: current?.id ?? null,
          currentDriverName: current?.name ?? null,
        };
      }),
    });
  } catch (e) {
    return fail(e);
  }
}
