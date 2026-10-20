import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";
import { updateDeliverySchema, firstError } from "@/lib/validation";
import { auditData } from "@/lib/notify";
import { toDeliveryDTO, toAssignmentDTO } from "@/lib/serializers";

type Params = { params: Promise<{ id: string }> };

// GET /api/deliveries/[id] — admin, or driver who is/was assigned to it
export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const delivery = await db.delivery.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        assignments: { orderBy: { assignedAt: "desc" }, include: { driver: true, vehicle: true } },
        events: { orderBy: { createdAt: "asc" } },
        pods: { orderBy: { capturedAt: "desc" } },
      },
    });
    if (!delivery) throw new ApiError(404, "Delivery not found");

    if (user.role !== "ADMIN") {
      const mine = delivery.assignments.some((a) => a.driverId === user.id);
      if (!mine) throw new ApiError(403, "You are not assigned to this delivery");
    }

    return ok({
      delivery: toDeliveryDTO({ ...delivery, _count: { pods: delivery.pods.length } }, user.role === "ADMIN"),
      events: delivery.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        note: e.note,
        actorName: e.actorName,
        customerVisible: e.customerVisible,
        createdAt: e.createdAt.toISOString(),
      })),
      assignments: delivery.assignments.map(toAssignmentDTO),
      pods: delivery.pods.map((p) => ({
        id: p.id,
        kind: p.kind,
        recipientName: p.recipientName,
        fileName: p.fileName,
        mimeType: p.mimeType,
        capturedAt: p.capturedAt.toISOString(),
        uploadedById: p.uploadedById,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/deliveries/[id] — edit details (admin)
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw new ApiError(403, "Admin access required");
    const { id } = await params;

    const delivery = await db.delivery.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!delivery) throw new ApiError(404, "Delivery not found");
    if (delivery.status === "DELIVERED" || delivery.status === "CANCELLED") {
      throw new ApiError(400, "Delivered or cancelled deliveries cannot be edited");
    }

    const parsed = updateDeliverySchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.delivery.update({
        where: { id },
        data: {
          ...(data.recipientName !== undefined ? { recipientName: data.recipientName } : {}),
          ...(data.recipientPhone !== undefined ? { recipientPhone: data.recipientPhone } : {}),
          ...(data.pickupAddress !== undefined ? { pickupAddress: data.pickupAddress } : {}),
          ...(data.deliveryAddress !== undefined ? { deliveryAddress: data.deliveryAddress } : {}),
          ...(data.instructions !== undefined ? { instructions: data.instructions || null } : {}),
          ...(data.priority !== undefined ? { priority: data.priority } : {}),
          ...(data.expectedAt !== undefined ? { expectedAt: data.expectedAt ? new Date(data.expectedAt) : null } : {}),
        },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "DELIVERY_UPDATED", entityType: "Delivery", entityId: id, detail: { fields: Object.keys(data) },
        }),
      });
      return u;
    });

    const full = await db.delivery.findUniqueOrThrow({
      where: { id: updated.id },
      include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } },
    });
    return ok({ delivery: toDeliveryDTO(full, true) });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/deliveries/[id] — only unstarted deliveries (admin)
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw new ApiError(403, "Admin access required");
    const { id } = await params;

    const delivery = await db.delivery.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { _count: { select: { assignments: true } } },
    });
    if (!delivery) throw new ApiError(404, "Delivery not found");
    if (delivery.status !== "CREATED" || delivery._count.assignments > 0) {
      throw new ApiError(400, "Only deliveries that were never assigned can be deleted. Use Cancel instead.");
    }

    await db.$transaction([
      db.deliveryEvent.deleteMany({ where: { deliveryId: id } }),
      db.delivery.delete({ where: { id } }),
      db.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "DELIVERY_DELETED", entityType: "Delivery", entityId: id, detail: { trackingCode: delivery.trackingCode },
        }),
      }),
    ]);
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
