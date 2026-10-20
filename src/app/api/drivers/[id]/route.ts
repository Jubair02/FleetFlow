import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { updateDriverSchema, firstError } from "@/lib/validation";
import { auditData } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/drivers/[id] — update profile / availability / activate / deactivate (admin)
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const parsed = updateDriverSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    const driver = await db.user.findFirst({
      where: { id, organizationId: user.organizationId, role: "DRIVER" },
      include: { driverProfile: true },
    });
    if (!driver || !driver.driverProfile) throw new ApiError(404, "Driver not found");

    if (data.active === false) {
      const activeJobs = await db.assignment.count({ where: { driverId: id, active: true } });
      if (activeJobs > 0) {
        throw new ApiError(400, `Driver has ${activeJobs} active job(s) — reassign or complete them before deactivating`);
      }
    }

    await db.$transaction(async (tx) => {
      if (data.name !== undefined) await tx.user.update({ where: { id }, data: { name: data.name } });
      await tx.driverProfile.update({
        where: { userId: id },
        data: {
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.licenseNumber !== undefined ? { licenseNumber: data.licenseNumber } : {}),
          ...(data.availability !== undefined ? { availability: data.availability } : {}),
          ...(data.maxActiveJobs !== undefined ? { maxActiveJobs: data.maxActiveJobs } : {}),
        },
      });
      if (data.active !== undefined) {
        await tx.user.update({ where: { id }, data: { active: data.active } });
        if (!data.active) {
          await tx.session.deleteMany({ where: { userId: id } }); // revoke sessions immediately
        }
      }
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "DRIVER_UPDATED", entityType: "User", entityId: id,
          detail: { fields: Object.keys(data), driver: driver.name },
        }),
      });
    });

    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
