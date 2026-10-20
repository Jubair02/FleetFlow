import { db } from "@/lib/db";
import { fail, ok, requireDriver } from "@/lib/api-helpers";
import { toDeliveryDTO } from "@/lib/serializers";

// GET /api/my/jobs?scope=active|history — the driver's own jobs.
// Drivers can never see deliveries outside their own assignments.
export async function GET(req: Request) {
  try {
    const user = await requireDriver();
    const scope = new URL(req.url).searchParams.get("scope") === "history" ? "history" : "active";

    const deliveryFilter =
      scope === "active"
        ? { organizationId: user.organizationId }
        : { organizationId: user.organizationId, status: { in: ["DELIVERED", "FAILED", "CANCELLED"] } };

    const assignments = await db.assignment.findMany({
      where: {
        driverId: user.id,
        delivery: deliveryFilter,
        ...(scope === "active" ? { active: true } : {}),
      },
      orderBy: { assignedAt: "desc" },
      include: {
        vehicle: true,
        delivery: { include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } } },
      },
      take: scope === "active" ? 50 : 60,
    });

    return ok({
      scope,
      items: assignments.map((a) => ({
        ...toDeliveryDTO(a.delivery, false),
        vehicle: a.vehicle ? { id: a.vehicle.id, registrationNumber: a.vehicle.registrationNumber, type: a.vehicle.type, capacity: a.vehicle.capacity } : null,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
