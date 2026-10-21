import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPlanLimit } from "@/lib/plans";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { updateVehicleSchema, firstError } from "@/lib/validation";
import { lockVehicle, TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

const DUPLICATE_REGISTRATION = "A vehicle with this registration number already exists";

// PATCH /api/vehicles/[id] — update vehicle / change status (admin)
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const parsed = updateVehicleSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    try {
      await db.$transaction(async (tx) => {
        // Lock first: dispatch takes the same lock, so the active-job check can't race an assignment.
        await lockVehicle(tx, id);
        const vehicle = await tx.vehicle.findFirst({ where: { id, organizationId: user.organizationId } });
        if (!vehicle) throw new ApiError(404, "Vehicle not found");

        if (data.registrationNumber && data.registrationNumber !== vehicle.registrationNumber) {
          const clash = await tx.vehicle.findFirst({
            where: { organizationId: user.organizationId, registrationNumber: data.registrationNumber, NOT: { id } },
            select: { id: true },
          });
          if (clash) throw new ApiError(409, DUPLICATE_REGISTRATION);
        }

        // bringing a deactivated vehicle back counts against the plan's vehicle limit
        if (vehicle.status === "INACTIVE" && data.status && data.status !== "INACTIVE") {
          await assertPlanLimit(tx, user.organizationId, "vehicles");
        }

        // taking a vehicle out of service while it carries active jobs would orphan dispatches
        if (data.status && data.status !== "ACTIVE" && data.status !== vehicle.status) {
          const activeJobs = await tx.assignment.count({ where: { vehicleId: id, active: true } });
          if (activeJobs > 0) {
            throw new ApiError(409, `Vehicle has ${activeJobs} active job(s) — reassign them before taking it out of service`);
          }
        }

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
      }, TX_OPTIONS);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(409, DUPLICATE_REGISTRATION);
      }
      throw e;
    }

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

    await db.$transaction(async (tx) => {
      // Lock so a concurrent dispatch can't attach an assignment between the check and the delete.
      await lockVehicle(tx, id);
      const vehicle = await tx.vehicle.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { _count: { select: { assignments: true } } },
      });
      if (!vehicle) throw new ApiError(404, "Vehicle not found");
      if (vehicle._count.assignments > 0) {
        throw new ApiError(409, "Vehicle has assignment history and cannot be deleted — set it to INACTIVE instead");
      }

      await tx.vehicle.delete({ where: { id } });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "VEHICLE_DELETED", entityType: "Vehicle", entityId: id,
          detail: { registrationNumber: vehicle.registrationNumber },
        }),
      });
    }, TX_OPTIONS);
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
