import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { assignSchema, firstError } from "@/lib/validation";
import { TX_OPTIONS, lockDelivery, lockDriver, lockVehicle, syncDriverAvailability } from "@/lib/delivery";
import { auditData, bestEffort, notifyInApp, notifyEmail } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// POST /api/deliveries/[id]/assign — transactional dispatch.
// Race-safe at READ COMMITTED: the transaction locks the delivery, then the
// driver profile, then the vehicle (the global lock order) before running the
// dispatchable / capacity / vehicle-in-use checks, so two concurrent dispatches
// of the same delivery, driver or vehicle are serialized and the second one
// sees the first one's assignment.
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const parsed = assignSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { driverId, vehicleId } = parsed.data;

    try {
      const result = await db.$transaction(async (tx) => {
        // 1) Delivery must exist in this org, be dispatchable and not already assigned
        await lockDelivery(tx, id, user.organizationId);
        const delivery = await tx.delivery.findUniqueOrThrow({
          where: { id },
          include: { assignments: { where: { active: true }, select: { id: true } } },
        });
        if (!["CREATED", "FAILED"].includes(delivery.status)) {
          throw new ApiError(409, `Delivery is ${delivery.status.toLowerCase().replace("_", " ")} — unassign it first if you want to re-dispatch`);
        }
        if (delivery.assignments.length) {
          throw new ApiError(409, "Delivery already has an active assignment — unassign it first");
        }

        // 2) Driver checks (profile locked → capacity check can't be raced)
        await lockDriver(tx, driverId);
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

        // 3) Vehicle checks (vehicle locked → in-use check can't be raced)
        await lockVehicle(tx, vehicleId);
        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, organizationId: user.organizationId } });
        if (!vehicle) throw new ApiError(400, "Vehicle not found in your organization");
        if (vehicle.status !== "ACTIVE") {
          throw new ApiError(400, `Vehicle ${vehicle.registrationNumber} is ${vehicle.status.toLowerCase()} and cannot be dispatched`);
        }
        // a driver may carry several jobs in one vehicle, but a vehicle can't be with two drivers
        const inUse = await tx.assignment.findFirst({
          where: { vehicleId, active: true, driverId: { not: driverId } },
          include: { driver: { select: { name: true } } },
        });
        if (inUse) {
          throw new ApiError(409, `Vehicle ${vehicle.registrationNumber} is in use by ${inUse.driver.name}`);
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
        // driver availability follows their active jobs (AVAILABLE → ON_ROUTE)
        await syncDriverAvailability(tx, driverId);
        return { delivery, driver, vehicle, assignment };
      }, TX_OPTIONS);

      // 5) Notify the driver (in-app + email) — outside the transaction, best effort
      await bestEffort("assign: driver notification", () =>
        Promise.all([
          notifyInApp({
            userId: driverId,
            type: "NEW_ASSIGNMENT",
            title: "New assignment",
            body: `${result.delivery.trackingCode} — pick up at ${result.delivery.pickupAddress.split(",")[0]}, deliver to ${result.delivery.deliveryAddress.split(",")[0]}.`,
            deliveryId: result.delivery.id,
          }),
          notifyEmail({
            organizationId: user.organizationId,
            userId: driverId,
            recipientEmail: result.driver.email,
            dedupeKey: `assigned:${result.assignment.id}:${driverId}`,
            type: "NEW_ASSIGNMENT",
            title: `[FleetFlow] New assignment ${result.delivery.trackingCode}`,
            body: `You have been assigned delivery ${result.delivery.trackingCode}. Open the FleetFlow driver app for details.`,
            deliveryId: result.delivery.id,
          }),
        ])
      );

      return ok({ success: true, assignmentId: result.assignment.id });
    } catch (txError) {
      // Serialization/write conflicts are unlikely with row locks, but still map cleanly
      if (txError instanceof Prisma.PrismaClientKnownRequestError && txError.code === "P2034") {
        throw new ApiError(409, "Concurrent dispatch detected — the assignment was not created. Please retry.");
      }
      throw txError;
    }
  } catch (e) {
    return fail(e);
  }
}
