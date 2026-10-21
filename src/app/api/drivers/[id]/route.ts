import { db } from "@/lib/db";
import { assertPlanLimit } from "@/lib/plans";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { updateDriverSchema, firstError } from "@/lib/validation";
import { lockDriver, syncDriverAvailability, TX_OPTIONS } from "@/lib/delivery";
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

    await db.$transaction(async (tx) => {
      // Lock first: dispatch takes the same lock, so the active-job checks below can't race an assignment.
      await lockDriver(tx, id);
      const driver = await tx.user.findFirst({
        where: { id, organizationId: user.organizationId, role: "DRIVER" },
        include: { driverProfile: true },
      });
      if (!driver || !driver.driverProfile) throw new ApiError(404, "Driver not found");

      const activeJobs = await tx.assignment.count({ where: { driverId: id, active: true } });
      if (data.active === false && driver.active && activeJobs > 0) {
        throw new ApiError(409, `Driver has ${activeJobs} active job(s) — reassign or complete them before deactivating`);
      }
      if (data.active === true && !driver.active) {
        await assertPlanLimit(tx, user.organizationId, "drivers");
      }
      if (data.availability === "OFF_DUTY" && driver.driverProfile.availability !== "OFF_DUTY" && activeJobs > 0) {
        throw new ApiError(409, `Driver has ${activeJobs} active job(s) — unassign their active jobs first`);
      }

      if (data.name !== undefined) await tx.user.update({ where: { id }, data: { name: data.name } });
      const profileData = {
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.licenseNumber !== undefined ? { licenseNumber: data.licenseNumber } : {}),
        ...(data.availability !== undefined ? { availability: data.availability } : {}),
        ...(data.maxActiveJobs !== undefined ? { maxActiveJobs: data.maxActiveJobs } : {}),
      };
      if (Object.keys(profileData).length) {
        await tx.driverProfile.update({ where: { userId: id }, data: profileData });
      }
      // AVAILABLE ↔ ON_ROUTE is derived from active jobs (e.g. a stale form sending AVAILABLE).
      await syncDriverAvailability(tx, id);

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
    }, TX_OPTIONS);

    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
