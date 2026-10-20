import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { createVehicleSchema, firstError } from "@/lib/validation";
import { auditData } from "@/lib/notify";

// GET /api/vehicles — org fleet with active job counts (admin)
export async function GET() {
  try {
    const user = await requireAdmin();
    const vehicles = await db.vehicle.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { registrationNumber: "asc" },
      include: { _count: { select: { assignments: { where: { active: true } } } } },
    });
    return ok({
      items: vehicles.map((v) => ({
        id: v.id,
        registrationNumber: v.registrationNumber,
        type: v.type,
        capacity: v.capacity || "",
        status: v.status,
        notes: v.notes || "",
        activeJobs: v._count.assignments,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/vehicles — register a vehicle (admin)
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = createVehicleSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    const clash = await db.vehicle.findFirst({
      where: { organizationId: user.organizationId, registrationNumber: data.registrationNumber },
    });
    if (clash) throw new ApiError(409, "A vehicle with this registration number already exists");

    const vehicle = await db.$transaction(async (tx) => {
      const v = await tx.vehicle.create({
        data: {
          organizationId: user.organizationId,
          registrationNumber: data.registrationNumber,
          type: data.type,
          capacity: data.capacity || null,
          notes: data.notes || null,
        },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "VEHICLE_REGISTERED", entityType: "Vehicle", entityId: v.id,
          detail: { registrationNumber: data.registrationNumber, type: data.type },
        }),
      });
      return v;
    });

    return ok({ success: true, vehicleId: vehicle.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
