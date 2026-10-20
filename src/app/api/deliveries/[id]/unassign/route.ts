import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { unassignSchema, firstError } from "@/lib/validation";
import { auditData, notifyInApp } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// POST /api/deliveries/[id]/unassign — release an active assignment (admin)
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const parsed = unassignSchema.safeParse(await readJson<unknown>(req).catch(() => ({})));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const reason = parsed.data.reason || "Released by dispatcher";

    const result = await db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { assignments: { where: { active: true }, include: { driver: true } } },
      });
      if (!delivery) throw new ApiError(404, "Delivery not found");
      if (!delivery.assignments.length) throw new ApiError(400, "Delivery has no active assignment");
      if (["DELIVERED", "CANCELLED"].includes(delivery.status)) {
        throw new ApiError(400, "Completed deliveries cannot be unassigned");
      }

      const active = delivery.assignments[0];
      await tx.assignment.update({
        where: { id: active.id },
        data: { active: false, unassignedAt: new Date() },
      });
      await tx.delivery.update({ where: { id: delivery.id }, data: { status: "CREATED" } });
      await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          eventType: "UNASSIGNED",
          actorId: user.id,
          actorName: user.name,
          note: `Unassigned from ${active.driver.name}: ${reason}`,
          customerVisible: false,
        },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "DRIVER_UNASSIGNED", entityType: "Delivery", entityId: delivery.id,
          detail: { trackingCode: delivery.trackingCode, driver: active.driver.name, reason },
        }),
      });
      // if the driver now has zero active jobs, mark them available again
      const remaining = await tx.assignment.count({ where: { driverId: active.driverId, active: true } });
      if (remaining === 0) {
        await tx.driverProfile.updateMany({ where: { userId: active.driverId, availability: "ON_ROUTE" }, data: { availability: "AVAILABLE" } });
      }
      return { delivery, driver: active.driver };
    });

    await notifyInApp({
      userId: result.driver.id,
      type: "UNASSIGNED",
      title: "Assignment removed",
      body: `${result.delivery.trackingCode} has been reassigned by dispatch.`,
      deliveryId: result.delivery.id,
    });

    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
