import { db } from "@/lib/db";
import { fail, ok, requireDriver } from "@/lib/api-helpers";
import { toDeliveryDTO } from "@/lib/serializers";

const vehicleDTO = (v: { id: string; registrationNumber: string; type: string; capacity: string | null } | null) =>
  v ? { id: v.id, registrationNumber: v.registrationNumber, type: v.type, capacity: v.capacity } : null;

// GET /api/my/jobs?scope=active|history — the driver's own jobs.
// Drivers can never see deliveries outside their own assignments.
// History lists how each of the driver's finished jobs ended (their own
// assignment's outcome), not the delivery's current state — reassignments
// after a failure don't leak the next driver's details.
export async function GET(req: Request) {
  try {
    const user = await requireDriver();
    const scope = new URL(req.url).searchParams.get("scope") === "history" ? "history" : "active";

    if (scope === "active") {
      const assignments = await db.assignment.findMany({
        where: { driverId: user.id, active: true, delivery: { organizationId: user.organizationId } },
        orderBy: { assignedAt: "desc" },
        include: {
          vehicle: true,
          delivery: { include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } } },
        },
        take: 50,
      });
      return ok({
        scope,
        items: assignments.map((a) => ({ ...toDeliveryDTO(a.delivery, false), vehicle: vehicleDTO(a.vehicle) })),
      });
    }

    // history: closed assignments that ended with a result (not plain unassignments)
    const assignments = await db.assignment.findMany({
      where: {
        driverId: user.id,
        active: false,
        outcome: { in: ["DELIVERED", "FAILED", "CANCELLED"] },
        delivery: { organizationId: user.organizationId },
      },
      orderBy: { assignedAt: "desc" },
      include: {
        vehicle: true,
        // only this driver's own (re)assignment may surface as the delivery's current assignment
        delivery: { include: { assignments: { where: { active: true, driverId: user.id }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } } },
      },
      take: 100,
    });

    // one row per delivery — keep this driver's latest attempt
    const seen = new Set<string>();
    const latest = assignments.filter((a) => {
      if (seen.has(a.deliveryId)) return false;
      seen.add(a.deliveryId);
      return true;
    });

    const items = latest
      .map((a) => ({
        ...toDeliveryDTO(a.delivery, false),
        vehicle: vehicleDTO(a.vehicle),
        outcome: a.outcome,
        endedAt: (a.completedAt ?? a.unassignedAt)?.toISOString() ?? null,
      }))
      .sort((x, y) => (y.endedAt ?? "").localeCompare(x.endedAt ?? ""));

    return ok({ scope, items });
  } catch (e) {
    return fail(e);
  }
}
