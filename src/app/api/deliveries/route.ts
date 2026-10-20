import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { createDeliverySchema, firstError } from "@/lib/validation";
import { generateTrackingCode, generateTrackingToken, addEvent } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { toDeliveryDTO } from "@/lib/serializers";
import type { Prisma } from "@prisma/client";

// GET /api/deliveries — org-scoped list with search/filters/pagination (admin)
export async function GET(req: Request) {
  try {
    const user = await requireAdmin();
    const url = new URL(req.url);
    const q = (key: string) => url.searchParams.get(key)?.trim() || "";

    const search = q("search");
    const statuses = q("status").split(",").filter(Boolean);
    const priority = q("priority");
    const driverId = q("driverId");
    const vehicleId = q("vehicleId");
    const from = q("from");
    const to = q("to");
    const page = Math.max(1, parseInt(q("page") || "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(q("pageSize") || "10", 10) || 10));

    const where: Prisma.DeliveryWhereInput = { organizationId: user.organizationId };
    if (search) {
      where.OR = [
        { trackingCode: { contains: search } },
        { recipientName: { contains: search } },
        { deliveryAddress: { contains: search } },
        { pickupAddress: { contains: search } },
      ];
    }
    if (statuses.length) where.status = { in: statuses };
    if (priority) where.priority = priority;
    if (driverId) where.assignments = { some: { driverId } };
    if (vehicleId) where.assignments = { some: { vehicleId } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999`);
    }

    const [total, items] = await Promise.all([
      db.delivery.count({ where }),
      db.delivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignments: { where: { active: true }, include: { driver: true, vehicle: true } },
          _count: { select: { pods: true } },
        },
      }),
    ]);

    return ok({
      items: items.map((d) => toDeliveryDTO(d, true)),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/deliveries — create (admin)
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const body = await readJson<unknown>(req);
    const parsed = createDeliverySchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    const delivery = await db.$transaction(async (tx) => {
      // retry on improbable tracking-code collision
      let code = generateTrackingCode();
      for (let i = 0; i < 3; i++) {
        const clash = await tx.delivery.findUnique({ where: { trackingCode: code } });
        if (!clash) break;
        code = generateTrackingCode();
      }
      const created = await tx.delivery.create({
        data: {
          organizationId: user.organizationId,
          trackingCode: code,
          trackingToken: generateTrackingToken(),
          recipientName: data.recipientName,
          recipientPhone: data.recipientPhone,
          pickupAddress: data.pickupAddress,
          deliveryAddress: data.deliveryAddress,
          instructions: data.instructions || null,
          priority: data.priority,
          expectedAt: data.expectedAt ? new Date(data.expectedAt) : null,
        },
      });
      await tx.deliveryEvent.create({
        data: {
          deliveryId: created.id,
          eventType: "CREATED",
          actorId: user.id,
          actorName: user.name,
          note: "Delivery created",
          customerVisible: true,
        },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId,
          actorId: user.id,
          actorName: user.name,
          action: "DELIVERY_CREATED",
          entityType: "Delivery",
          entityId: created.id,
          detail: { trackingCode: code, recipient: data.recipientName },
        }),
      });
      return created;
    });

    const full = await db.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } },
    });
    return ok({ delivery: toDeliveryDTO(full, true) }, 201);
  } catch (e) {
    return fail(e);
  }
}
