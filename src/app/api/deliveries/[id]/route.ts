import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";
import { updateDeliverySchema, firstError } from "@/lib/validation";
import { driverCanReadDelivery } from "@/lib/constants";
import { TX_OPTIONS, lockDelivery } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { toDeliveryDTO, toAssignmentDTO } from "@/lib/serializers";

type Params = { params: Promise<{ id: string }> };

// GET /api/deliveries/[id] — admin, or a driver who holds it now, delivered it,
// or made the latest (failed/cancelled) attempt and it hasn't been reassigned since
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

    const isAdmin = user.role === "ADMIN";
    if (!isAdmin && !driverCanReadDelivery(delivery.assignments, user.id)) {
      throw new ApiError(403, "You are not assigned to this delivery");
    }

    return ok({
      delivery: toDeliveryDTO({ ...delivery, _count: { pods: delivery.pods.length } }, isAdmin),
      events: delivery.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        note: e.note,
        actorName: e.actorName,
        customerVisible: e.customerVisible,
        createdAt: e.createdAt.toISOString(),
      })),
      // drivers only see their own assignment history, never other drivers'
      assignments: delivery.assignments.filter((a) => isAdmin || a.driverId === user.id).map(toAssignmentDTO),
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

// PATCH /api/deliveries/[id] — edit details (admin). Only fields that were
// sent are written, and only fields that actually changed are audited.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw new ApiError(403, "Admin access required");
    const { id } = await params;

    const parsed = updateDeliverySchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    // requested values, normalized to their stored form (undefined = not sent)
    const requested = {
      recipientName: data.recipientName,
      recipientPhone: data.recipientPhone,
      pickupAddress: data.pickupAddress,
      deliveryAddress: data.deliveryAddress,
      instructions: data.instructions === undefined ? undefined : data.instructions || null,
      externalRef: data.externalRef === undefined ? undefined : data.externalRef || null,
      recipientEmail: data.recipientEmail === undefined ? undefined : data.recipientEmail || null,
      priority: data.priority,
      expectedAt: data.expectedAt === undefined ? undefined : data.expectedAt ? new Date(data.expectedAt) : null,
    };

    await db.$transaction(async (tx) => {
      await lockDelivery(tx, id, user.organizationId);
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id } });
      if (delivery.status === "DELIVERED" || delivery.status === "CANCELLED") {
        throw new ApiError(409, "Delivered or cancelled deliveries cannot be edited");
      }

      const changes: Record<string, string | Date | null> = {};
      for (const [field, value] of Object.entries(requested)) {
        if (value === undefined) continue;
        const current = delivery[field as keyof typeof requested];
        const same = value instanceof Date || current instanceof Date
          ? (value as Date | null)?.getTime() === (current as Date | null)?.getTime()
          : value === current;
        if (!same) changes[field] = value;
      }
      const fields = Object.keys(changes);
      if (!fields.length) return; // nothing changed — no write, no audit noise

      await tx.delivery.update({ where: { id }, data: changes as Prisma.DeliveryUpdateInput });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "DELIVERY_UPDATED", entityType: "Delivery", entityId: id,
          detail: { trackingCode: delivery.trackingCode, fields },
        }),
      });
    }, TX_OPTIONS);

    const full = await db.delivery.findUniqueOrThrow({
      where: { id },
      include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } },
    });
    return ok({ delivery: toDeliveryDTO(full, true) });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/deliveries/[id] — only deliveries that were never assigned (admin)
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw new ApiError(403, "Admin access required");
    const { id } = await params;

    await db.$transaction(async (tx) => {
      // lock first so a concurrent dispatch can't slip an assignment in
      await lockDelivery(tx, id, user.organizationId);
      const delivery = await tx.delivery.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { assignments: true } } },
      });
      if (delivery.status !== "CREATED" || delivery._count.assignments > 0) {
        throw new ApiError(409, "Only deliveries that were never assigned can be deleted. Use Cancel instead.");
      }

      await tx.deliveryEvent.deleteMany({ where: { deliveryId: id } });
      await tx.delivery.delete({ where: { id } });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "DELIVERY_DELETED", entityType: "Delivery", entityId: id, detail: { trackingCode: delivery.trackingCode },
        }),
      });
    }, TX_OPTIONS);
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
