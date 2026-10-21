import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPlanLimit } from "@/lib/plans";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { createVehicleSchema, firstError } from "@/lib/validation";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";

const DUPLICATE_REGISTRATION = "A vehicle with this registration number already exists";

// GET /api/vehicles — org fleet with active job + all-time assignment counts (admin)
export async function GET() {
  try {
    const user = await requireAdmin();
    const [vehicles, activeCounts] = await Promise.all([
      db.vehicle.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { registrationNumber: "asc" },
        include: { _count: { select: { assignments: true } } },
      }),
      db.assignment.groupBy({
        by: ["vehicleId"],
        where: { active: true, vehicle: { organizationId: user.organizationId } },
        _count: { _all: true },
      }),
    ]);
    const activeMap = new Map(activeCounts.map((c) => [c.vehicleId, c._count._all]));

    return ok({
      items: vehicles.map((v) => ({
        id: v.id,
        registrationNumber: v.registrationNumber,
        type: v.type,
        capacity: v.capacity || "",
        status: v.status,
        notes: v.notes || "",
        activeJobs: activeMap.get(v.id) ?? 0,
        assignmentCount: v._count.assignments,
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
      select: { id: true },
    });
    if (clash) throw new ApiError(409, DUPLICATE_REGISTRATION);

    let vehicle;
    try {
      vehicle = await db.$transaction(async (tx) => {
        await assertPlanLimit(tx, user.organizationId, "vehicles");
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
      }, TX_OPTIONS);
    } catch (e) {
      // concurrent registration of the same number slipped past the pre-check
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(409, DUPLICATE_REGISTRATION);
      }
      throw e;
    }

    return ok({ success: true, vehicleId: vehicle.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
