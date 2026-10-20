import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";
import { statusChangeSchema, firstError } from "@/lib/validation";
import { isValidAdminTransition, isValidDriverTransition, type DeliveryStatus } from "@/lib/constants";
import { auditData, notifyAdmins } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/deliveries/[id]/status — the delivery state machine.
 *
 * Drivers may only move their own actively-assigned deliveries along
 * ASSIGNED→PICKED_UP→IN_TRANSIT→DELIVERED, or →FAILED with a reason.
 *
 * Admins can cancel pending/failed deliveries; any other change is an
 * explicit OVERRIDE that requires a reason and is fully audited.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const parsed = statusChangeSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { status: to, note, failureReason } = parsed.data;
    if (to === "ASSIGNED") {
      throw new ApiError(400, "Use the Assign action to dispatch a driver — status cannot be set to ASSIGNED directly");
    }

    const result = await db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { assignments: { where: { active: true }, include: { driver: true } } },
      });
      if (!delivery) throw new ApiError(404, "Delivery not found");
      const from = delivery.status as DeliveryStatus;
      if (from === to) throw new ApiError(400, `Delivery is already ${from.replace("_", " ").toLowerCase()}`);

      const active = delivery.assignments[0] ?? null;
      const isAdmin = user.role === "ADMIN";
      let isOverride = false;

      if (!isAdmin) {
        // ── driver path ──
        if (!user.driverProfile) throw new ApiError(403, "Driver profile required");
        if (!active || active.driverId !== user.id) {
          throw new ApiError(403, "You can only update deliveries assigned to you");
        }
        if (!isValidDriverTransition(from, to)) {
          throw new ApiError(400, `Invalid transition: ${from.replace("_", " ")} → ${to.replace("_", " ")}${from === "CREATED" ? " (delivery must be assigned first)" : ""}`);
        }
        if (to === "FAILED" && !failureReason) throw new ApiError(400, "A failure reason is required");
        if (to === "DELIVERED") {
          const podCount = await tx.proofOfDelivery.count({ where: { deliveryId: delivery.id } });
          if (podCount === 0) {
            throw new ApiError(400, "Proof of delivery must be uploaded before marking as delivered");
          }
        }
      } else {
        // ── admin path ──
        if (isValidAdminTransition(from, to)) {
          if (to === "CANCELLED") {
            if (!note || !note.trim()) throw new ApiError(400, "A cancellation reason is required");
          }
        } else {
          // explicit override — audited, reason mandatory
          if (!note || !note.trim()) throw new ApiError(400, "Override requires a reason for the audit log");
          if (to === "FAILED" && !failureReason) throw new ApiError(400, "A failure reason is required");
          if (to === "DELIVERED") {
            const podCount = await tx.proofOfDelivery.count({ where: { deliveryId: delivery.id } });
            if (podCount === 0) throw new ApiError(400, "Cannot mark delivered without proof of delivery");
          }
          isOverride = true;
        }
      }

      // ── apply ──
      const now = new Date();
      const data: Record<string, unknown> = { status: to };
      if (to === "DELIVERED") data.completedAt = now;
      if (to === "FAILED") data.failureReason = failureReason || "OTHER";
      if (from === "DELIVERED" && to !== "DELIVERED") data.completedAt = null; // override away from delivered

      await tx.delivery.update({ where: { id: delivery.id }, data });

      // close the active assignment on terminal outcomes
      if (["DELIVERED", "FAILED", "CANCELLED"].includes(to) && active) {
        await tx.assignment.update({
          where: { id: active.id },
          data: { active: false, unassignedAt: now, ...(to === "DELIVERED" ? { completedAt: now } : {}) },
        });
        const remaining = await tx.assignment.count({ where: { driverId: active.driverId, active: true } });
        if (remaining === 0) {
          await tx.driverProfile.updateMany({ where: { userId: active.driverId, availability: "ON_ROUTE" }, data: { availability: "AVAILABLE" } });
        }
      }

      const eventNote =
        to === "FAILED"
          ? failureReason || note || "Delivery failed"
          : to === "CANCELLED"
            ? note || "Cancelled"
            : isOverride
              ? `Override → ${to}: ${note}`
              : note || null;

      await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          eventType: isOverride ? "OVERRIDE" : to,
          actorId: user.id,
          actorName: user.name,
          note: eventNote,
          customerVisible: true,
        },
      });
      if (isOverride) {
        await tx.deliveryEvent.create({
          data: {
            deliveryId: delivery.id,
            eventType: to,
            actorId: user.id,
            actorName: user.name,
            note: `Status set to ${to.replace("_", " ").toLowerCase()} (override)`,
            customerVisible: true,
          },
        });
      }
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: isOverride ? "STATUS_OVERRIDE" : `STATUS_${to}`,
          entityType: "Delivery", entityId: delivery.id,
          detail: { trackingCode: delivery.trackingCode, from, to, reason: note || failureReason || null },
        }),
      });

      return { delivery, from, toStatus: to, driver: active?.driver ?? null };
    });

    // ── notifications (outside tx) ──
    const { delivery, from, toStatus, driver } = result;
    const notifyDriverOfCancel = toStatus === "CANCELLED" && driver;
    if (notifyDriverOfCancel) {
      await db.notification.create({
        data: {
          userId: driver.id, type: "UNASSIGNED", channel: "IN_APP", title: "Delivery cancelled",
          body: `${delivery.trackingCode} was cancelled by dispatch.`, deliveryId: delivery.id,
        },
      });
    }
    if (!notifyDriverOfCancel && user.role === "DRIVER") {
      const labels: Record<string, [string, string]> = {
        PICKED_UP: ["Pickup confirmed", `${delivery.trackingCode} has been picked up by ${user.name}.`],
        IN_TRANSIT: ["Delivery in transit", `${delivery.trackingCode} is on the way with ${user.name}.`],
        DELIVERED: ["Delivery completed", `${delivery.trackingCode} was delivered — proof of delivery recorded.`],
        FAILED: ["Delivery attempt failed", `${delivery.trackingCode} failed: ${failureReason || "unknown reason"}. Reassign or reschedule.`],
      };
      const l = labels[toStatus];
      if (l) {
        await notifyAdmins(user.organizationId, { type: toStatus, title: l[0], body: l[1], deliveryId: delivery.id }, { email: toStatus === "DELIVERED" || toStatus === "FAILED" });
      }
    }

    return ok({ success: true, from, to: toStatus });
  } catch (e) {
    return fail(e);
  }
}
