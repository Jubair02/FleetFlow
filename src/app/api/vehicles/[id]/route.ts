import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { updateVehicleSchema, firstError } from "@/lib/validation";
import { auditData } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/vehicles/[id] — update vehicle / change status (admin)
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const parsed = updateVehicleSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    const vehicle = await db.vehicle.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!vehicle) throw new ApiError(404, "Vehicle not found");

    if (data.registrationNumber && data.registrationNumber !== vehicle.registrationNumber) {
      const clash = await db.vehicle.findFirst({
        where: { organizationId: user.organizationId, registrationNumber: data.registrationNumber, NOT: { id } },
      });
      if (clash) throw new ApiError(409, "A vehicle with this registration number already exists");
    }

    // moving a vehicle out of ACTIVE while it carries active jobs would orphan dispatches
    if (data.status && data.status !== "ACTIVE" && vehicle.status === "ACTIVE") {
      const activeJobs = await db.assignment.count({ where: { vehicleId: id, active: true } });
      if (activeJobs > 0) {
        throw new ApiError(400, `Vehicle has ${activeJobs} active job(s) — reassign them before scheduling maintenance`);
      }
    }

    await db.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { id },
        data: {
          ...(data.registrationNumber !== undefined ? { registrationNumber: data.registrationNumber } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.capacity !== undefined ? { capacity: data.capacity || null } : {}),
          ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: data.status && data.status !== vehicle.status ? "VEHICLE_STATUS_CHANGED" : "VEHICLE_UPDATED",
          entityType: "Vehicle", entityId: id,
          detail: { registrationNumber: vehicle.registrationNumber, fields: Object.keys(data), ...(data.status ? { from: vehicle.status, to: data.status } : {}) },
        }),
      });
    });

    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/vehicles/[id] — only vehicles with no assignment history (admin)
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const vehicle = await db.vehicle.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { _count: { select: { assignments: true } } },
    });
    if (!vehicle) throw new ApiError(404, "Vehicle not found");
    if (vehicle._count.assignments > 0) {
      throw new ApiError(400, "Vehicle has assignment history and cannot be deleted — set it to INACTIVE instead");
    }

    await db.$transaction([
      db.vehicle.delete({ where: { id } }),
      db.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "VEHICLE_DELETED", entityType: "Vehicle", entityId: id,
          detail: { registrationNumber: vehicle.registrationNumber },
        }),
      }),
    ]);
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
