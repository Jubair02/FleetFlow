import { db } from "@/lib/db";
import { assertPlanLimit } from "@/lib/plans";
import { ApiError, fail, ok, parseDateParam, readJson, requireAdmin } from "@/lib/api-helpers";
import { createDeliverySchema, firstError } from "@/lib/validation";
import { generateTrackingCode, generateTrackingToken, TX_OPTIONS } from "@/lib/delivery";
import { auditData, bestEffort, sendCustomerTrackingEmail } from "@/lib/notify";
import { toDeliveryDTO } from "@/lib/serializers";
import { Prisma } from "@prisma/client";

const MAX_CREATE_ATTEMPTS = 5;

/** True when a unique-constraint error was caused by a tracking code/token collision. */
function isTrackingCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return /trackingCode|trackingToken/i.test(fields);
}

// GET /api/deliveries — org-scoped list with search/filters/pagination (admin)
// Date filters: `from` inclusive, `to` exclusive (ISO instants, see src/lib/types.ts).
export async function GET(req: Request) {
  try {
    const user = await requireAdmin();
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

    const [total, items] = await Promise.all([
      db.delivery.count({ where }),
      db.delivery.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

    // A tracking code/token collision aborts the whole Postgres transaction,
    // so on P2002 the entire create is retried with freshly generated values.
    const createOnce = () =>
      db.$transaction(async (tx) => {
        await assertPlanLimit(tx, user.organizationId, "monthlyDeliveries");
        const created = await tx.delivery.create({
          data: {
            organizationId: user.organizationId,
            trackingCode: generateTrackingCode(),
            trackingToken: generateTrackingToken(),
            recipientName: data.recipientName,
            recipientPhone: data.recipientPhone,
            pickupAddress: data.pickupAddress,
            deliveryAddress: data.deliveryAddress,
            instructions: data.instructions || null,
            externalRef: data.externalRef || null,
            recipientEmail: data.recipientEmail || null,
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
            detail: { trackingCode: created.trackingCode, recipient: data.recipientName },
          }),
        });
        return created;
      }, TX_OPTIONS);

    let delivery: Awaited<ReturnType<typeof createOnce>> | null = null;
    for (let attempt = 1; !delivery; attempt++) {
      try {
        delivery = await createOnce();
      } catch (e) {
        if (attempt < MAX_CREATE_ATTEMPTS && isTrackingCollision(e)) continue;
        throw e;
      }
    }

    const created = delivery;
    await bestEffort("customer tracking email", () =>
      sendCustomerTrackingEmail({
        organizationId: user.organizationId,
        deliveryId: created.id,
        trackingCode: created.trackingCode,
        trackingToken: created.trackingToken,
        recipientName: created.recipientName,
        recipientEmail: created.recipientEmail,
      })
    );

    const full = await db.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: { assignments: { where: { active: true }, include: { driver: true, vehicle: true } }, _count: { select: { pods: true } } },
    });
    return ok({ delivery: toDeliveryDTO(full, true) }, 201);
  } catch (e) {
    return fail(e);
  }
}
