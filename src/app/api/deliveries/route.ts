import { db } from "@/lib/db";
import { ApiError, fail, ok, parseDateParam, readJson, requireStaff } from "@/lib/api-helpers";
import { createStaffDeliverySchema, firstError } from "@/lib/validation";
import { createDelivery } from "@/lib/delivery-service";
import { parseDeliveryPoint } from "@/lib/geocoding";
import { DELIVERY_ZONE_INCLUDE, toDeliveryDTO } from "@/lib/serializers";
import type { Prisma } from "@prisma/client";

// GET /api/deliveries — org-scoped list with search/filters/pagination (admin)
// Date filters: `from` inclusive, `to` exclusive (ISO instants, see src/lib/types.ts).
export async function GET(req: Request) {
  try {
    const user = await requireStaff();
    const url = new URL(req.url);
    const q = (key: string) => url.searchParams.get(key)?.trim() || "";

    const search = q("search").slice(0, 200);
    const statuses = q("status").split(",").map((s) => s.trim()).filter(Boolean);
    const priority = q("priority");
    const driverId = q("driverId");
    const vehicleId = q("vehicleId");
    const from = parseDateParam(q("from"), "from");
    const to = parseDateParam(q("to"), "to");
    const page = Math.min(100_000, Math.max(1, parseInt(q("page") || "1", 10) || 1));
    const pageSize = Math.min(50, Math.max(5, parseInt(q("pageSize") || "10", 10) || 10));

    const where: Prisma.DeliveryWhereInput = { organizationId: user.organizationId };
    if (search) {
      where.OR = [
        { trackingCode: { contains: search, mode: "insensitive" } },
        { externalRef: { contains: search, mode: "insensitive" } },
        { recipientName: { contains: search, mode: "insensitive" } },
        { deliveryAddress: { contains: search, mode: "insensitive" } },
        { pickupAddress: { contains: search, mode: "insensitive" } },
      ];
    }
    if (statuses.length) where.status = { in: statuses.slice(0, 20) };
    // Customer reschedule requests from the tracking page (?reschedule=PENDING).
    const reschedule = q("reschedule").toUpperCase();
    if (reschedule === "PENDING" || reschedule === "ACCEPTED" || reschedule === "DECLINED") where.rescheduleStatus = reschedule;
    if (priority) where.priority = priority;
    // Both filters must match the same assignment.
    const importBatchId = q("importBatchId");
    if (importBatchId) where.importBatchId = importBatchId;
    if (driverId || vehicleId) {
      where.assignments = {
        some: {
          ...(driverId ? { driverId } : {}),
          ...(vehicleId ? { vehicleId } : {}),
        },
      };
    }
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      };
    }

    const [total, items, pendingReschedules] = await Promise.all([
      db.delivery.count({ where }),
      db.delivery.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignments: { where: { active: true }, include: { driver: true, vehicle: true } },
          _count: { select: { pods: true } },
          ...DELIVERY_ZONE_INCLUDE,
        },
      }),
      db.delivery.count({ where: { organizationId: user.organizationId, rescheduleStatus: "PENDING" } }),
    ]);

    return ok({
      items: items.map((d) => toDeliveryDTO(d, true)),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      pendingReschedules,
    });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/deliveries — create (admin). Shared with the public API: src/lib/delivery-service.ts
export async function POST(req: Request) {
  try {
    const user = await requireStaff();
    const body = await readJson<unknown>(req);
    const parsed = createStaffDeliverySchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    // a pin dropped on the map; without one the address is geocoded after the response
    const pin = parseDeliveryPoint(parsed.data.deliveryLat, parsed.data.deliveryLng);

    const { delivery } = await createDelivery(
      { organizationId: user.organizationId, actorId: user.id, actorName: user.name },
      parsed.data,
      { point: pin ? { ...pin, source: "PIN" } : null }
    );

    const full = await db.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } }, ...DELIVERY_ZONE_INCLUDE },
    });
    return ok({ delivery: toDeliveryDTO(full, true) }, 201);
  } catch (e) {
    return fail(e);
  }
}
