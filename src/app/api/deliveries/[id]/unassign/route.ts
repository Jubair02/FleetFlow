import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { unassignSchema, firstError } from "@/lib/validation";
import { TX_OPTIONS, closeAssignment, lockDelivery } from "@/lib/delivery";
import { auditData, bestEffort, notifyInApp } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// POST /api/deliveries/[id]/unassign — release an active assignment (admin).
// The delivery is locked first, so the assignment closed here is the one
// that is actually active right now (outcome UNASSIGNED).
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const parsed = unassignSchema.safeParse(await readJson<unknown>(req).catch(() => ({})));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const reason = parsed.data.reason || "Released by dispatcher";

    const result = await db.$transaction(async (tx) => {
      await lockDelivery(tx, id, user.organizationId);
      const delivery = await tx.delivery.findUniqueOrThrow({
        where: { id },
        include: { assignments: { where: { active: true }, include: { driver: true } } },
      });
      if (["DELIVERED", "CANCELLED"].includes(delivery.status)) {
        throw new ApiError(409, "Completed deliveries cannot be unassigned");
      }
      if (!delivery.assignments.length) throw new ApiError(409, "Delivery has no active assignment");

      const active = delivery.assignments[0];
      await closeAssignment(tx, active, "UNASSIGNED");
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
      return { delivery, driver: active.driver };
    }, TX_OPTIONS);

    await bestEffort("unassign: driver notification", () =>
      notifyInApp({
        userId: result.driver.id,
        type: "UNASSIGNED",
        title: "Assignment removed",
        body: `${result.delivery.trackingCode} has been reassigned by dispatch.`,
        deliveryId: result.delivery.id,
      })
    );

    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
