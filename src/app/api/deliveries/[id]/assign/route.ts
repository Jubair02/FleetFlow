import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { assignSchema, firstError } from "@/lib/validation";
import { auditData, notifyInApp, notifyEmail } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// POST /api/deliveries/[id]/assign — transactional dispatch.
// Race-safe: the capacity + availability checks run inside the same
// transaction as the assignment write, and SQLite serializes writers,
// so two concurrent dispatches cannot both pass the checks.
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const parsed = assignSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { driverId, vehicleId } = parsed.data;

    try {
      const result = await db.$transaction(async (tx) => {
        // 1) Delivery must exist in this org and be dispatchable
        const delivery = await tx.delivery.findFirst({ where: { id, organizationId: user.organizationId } });
        if (!delivery) throw new ApiError(404, "Delivery not found");
        if (!["CREATED", "FAILED"].includes(delivery.status)) {
          throw new ApiError(409, `Delivery is ${delivery.status.toLowerCase().replace("_", " ")} — unassign it first if you want to re-dispatch`);
        }

        // 2) Driver checks
        const driver = await tx.user.findUnique({
          where: { id: driverId },
          include: { driverProfile: true },
        });
        if (!driver || driver.organizationId !== user.organizationId || driver.role !== "DRIVER" || !driver.driverProfile) {
          throw new ApiError(400, "Driver not found in your organization");
        }
        if (!driver.active) throw new ApiError(400, `${driver.name}'s account is deactivated`);
        if (driver.driverProfile.availability === "OFF_DUTY") {
          throw new ApiError(400, `${driver.name} is currently off duty`);
        }
        const activeCount = await tx.assignment.count({ where: { driverId, active: true } });
        if (activeCount >= driver.driverProfile.maxActiveJobs) {
          throw new ApiError(409, `${driver.name} is at capacity (${activeCount}/${driver.driverProfile.maxActiveJobs} active jobs)`);
        }

        // 3) Vehicle checks
        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, organizationId: user.organizationId } });
        if (!vehicle) throw new ApiError(400, "Vehicle not found in your organization");
        if (vehicle.status !== "ACTIVE") {
          throw new ApiError(400, `Vehicle ${vehicle.registrationNumber} is ${vehicle.status.toLowerCase()} and cannot be dispatched`);
        }

        // 4) Create assignment + flip status atomically
        const assignment = await tx.assignment.create({
          data: { deliveryId: delivery.id, driverId, vehicleId },
        });
        await tx.delivery.update({
          where: { id: delivery.id },
          data: { status: "ASSIGNED", failureReason: null },
        });
        await tx.deliveryEvent.create({
          data: {
            deliveryId: delivery.id,
            eventType: "ASSIGNED",
            actorId: user.id,
            actorName: user.name,
            note: `Assigned to ${driver.name} · ${vehicle.registrationNumber}`,
            customerVisible: true,
          },
        });
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "DRIVER_ASSIGNED", entityType: "Delivery", entityId: delivery.id,
            detail: { trackingCode: delivery.trackingCode, driver: driver.name, vehicle: vehicle.registrationNumber },
          }),
        });
        // auto-set driver availability to ON_ROUTE when they take a job
        if (driver.driverProfile.availability === "AVAILABLE") {
          await tx.driverProfile.update({ where: { userId: driverId }, data: { availability: "ON_ROUTE" } });
        }
        return { delivery, driver, vehicle, assignment };
      });

      // 5) Notify the driver (in-app + email) — outside the transaction
      await Promise.all([
        notifyInApp({
          userId: driverId,
          type: "NEW_ASSIGNMENT",
          title: "New assignment",
          body: `${result.delivery.trackingCode} — pick up at ${result.delivery.pickupAddress.split(",")[0]}, deliver to ${result.delivery.deliveryAddress.split(",")[0]}.`,
          deliveryId: result.delivery.id,
        }),
        notifyEmail({
          userId: driverId,
          recipientEmail: result.driver.email,
          type: "NEW_ASSIGNMENT",
          title: `[FleetFlow] New assignment ${result.delivery.trackingCode}`,
          body: `You have been assigned delivery ${result.delivery.trackingCode}. Open the FleetFlow driver app for details.`,
          deliveryId: result.delivery.id,
        }),
      ]);

      return ok({ success: true, assignmentId: result.assignment.id });
    } catch (txError) {
      // Prisma transaction write conflicts (concurrent dispatch race)
      if (txError instanceof Error && /busy|conflict|P2034/i.test(txError.message)) {
        throw new ApiError(409, "Concurrent dispatch detected — the assignment was not created. Please retry.");
      }
      throw txError;
    }
  } catch (e) {
    return fail(e);
  }
}
