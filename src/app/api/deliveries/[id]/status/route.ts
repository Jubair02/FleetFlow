import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";
import { statusChangeSchema, firstError } from "@/lib/validation";
import { failureReasonLabel, isValidAdminTransition, isValidDriverTransition, type DeliveryStatus } from "@/lib/constants";
import { TX_OPTIONS, closeAssignment, lockDelivery, type AssignmentOutcome } from "@/lib/delivery";
import { auditData, bestEffort, notifyAdmins, notifyInApp, sendCustomerOutcomeEmail } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// Which outcome the active assignment is closed with when the delivery moves to a status.
// In-flight statuses (PICKED_UP / IN_TRANSIT) keep the assignment open.
const CLOSING_OUTCOME: Partial<Record<DeliveryStatus, AssignmentOutcome>> = {
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  CREATED: "UNASSIGNED",
};

const label = (s: string) => s.replace("_", " ").toLowerCase();

/**
 * POST /api/deliveries/[id]/status — the delivery state machine.
 *
 * Drivers may only move their own actively-assigned deliveries along
 * ASSIGNED→PICKED_UP→IN_TRANSIT→DELIVERED, or →FAILED with a reason.
 *
 * Admins can cancel pending/failed deliveries; any other change is an
 * explicit OVERRIDE that requires a reason and is fully audited. Overrides
 * cannot put a delivery in flight without a driver, and finished deliveries
 * can only be reopened (DELIVERED → CREATED/FAILED, CANCELLED → CREATED).
 *
 * Race-safe: the delivery row is locked before the transition is checked.
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
      await lockDelivery(tx, id, user.organizationId);
      const delivery = await tx.delivery.findUniqueOrThrow({
        where: { id },
        include: { assignments: { where: { active: true }, include: { driver: true } } },
      });
      const from = delivery.status as DeliveryStatus;
      if (from === to) throw new ApiError(409, `Delivery is already ${label(from)}`);

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
          throw new ApiError(409, `Invalid transition: ${from.replace("_", " ")} → ${to.replace("_", " ")}${from === "CREATED" ? " (delivery must be assigned first)" : ""}`);
        }
        if (to === "FAILED" && !failureReason) throw new ApiError(400, "A failure reason is required");
        if (to === "DELIVERED") {
          // the proof must come from this driver during this assignment
          const podCount = await tx.proofOfDelivery.count({
            where: { deliveryId: delivery.id, uploadedById: user.id, capturedAt: { gte: active.assignedAt } },
          });
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
          if (from === "DELIVERED" && to !== "CREATED" && to !== "FAILED") {
            throw new ApiError(409, "A delivered delivery can only be reopened as pending or marked failed");
          }
          if (from === "CANCELLED" && to !== "CREATED") {
            throw new ApiError(409, "A cancelled delivery can only be reopened as pending");
          }
          if ((to === "PICKED_UP" || to === "IN_TRANSIT") && !active) {
            throw new ApiError(409, "Assign a driver before moving the delivery in flight");
          }
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
      const data: Prisma.DeliveryUpdateInput = { status: to };
      if (to === "DELIVERED") data.completedAt = now;
      else if (from === "DELIVERED") data.completedAt = null; // override away from delivered
      data.failureReason = to === "FAILED" ? failureReason || "OTHER" : null;

      await tx.delivery.update({ where: { id: delivery.id }, data });

      // close the active assignment when the delivery leaves the driver's hands
      const outcome = CLOSING_OUTCOME[to];
      if (outcome && active) await closeAssignment(tx, active, outcome, now);

      // keep the driver's free-text note next to the reason label
      const failedNote = `${failureReasonLabel(failureReason || "OTHER")}${note ? ` — ${note}` : ""}`;
      const eventNote = isOverride
        ? `Override → ${to}: ${note}`
        : to === "FAILED"
          ? failedNote
          : to === "CANCELLED"
            ? note || "Cancelled"
            : note || null;

      await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          eventType: isOverride ? "OVERRIDE" : to,
          actorId: user.id,
          actorName: user.name,
          note: eventNote,
          // the override marker is internal; the status event below is what customers see
          customerVisible: !isOverride,
        },
      });
      if (isOverride) {
        await tx.deliveryEvent.create({
          data: {
            deliveryId: delivery.id,
            eventType: to,
            actorId: user.id,
            actorName: user.name,
            note: to === "FAILED" ? `${failureReasonLabel(failureReason)} (override)` : `Status set to ${label(to)} (override)`,
            customerVisible: true,
          },
        });
      }
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: isOverride ? "STATUS_OVERRIDE" : `STATUS_${to}`,
          entityType: "Delivery", entityId: delivery.id,
          detail: { trackingCode: delivery.trackingCode, from, to, reason: note || failureReason || null, ...(to === "FAILED" ? { failureReason } : {}) },
        }),
      });

      return { delivery, from, toStatus: to, closedDriver: outcome && active ? active.driver : null };
    }, TX_OPTIONS);

    // ── notifications (outside tx, best effort) ──
    const { delivery, from, toStatus, closedDriver } = result;
    const reasonText = `${failureReasonLabel(failureReason)}${note ? ` — ${note}` : ""}`;
    // Email dedupe key for this outcome: delivered is terminal (one per delivery);
    // a delivery can fail more than once, so failures are keyed by their event.
    let eventKeyCache: string | null = null;
    const outcomeEventKey = async () => {
      if (eventKeyCache) return eventKeyCache;
      if (toStatus === "DELIVERED") return (eventKeyCache = `delivered:${delivery.id}`);
      const ev = await db.deliveryEvent.findFirst({
        where: { deliveryId: delivery.id, eventType: "FAILED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      return (eventKeyCache = `failed:${ev?.id ?? `${delivery.id}:${Date.now()}`}`);
    };

    // an admin action took the job off a driver's list — tell them
    if (user.role === "ADMIN" && closedDriver) {
      const driverMsgs: Record<string, [string, string, string]> = {
        CANCELLED: ["UNASSIGNED", "Delivery cancelled", `${delivery.trackingCode} was cancelled by dispatch.`],
        CREATED: ["UNASSIGNED", "Assignment removed", `${delivery.trackingCode} was returned to the pending queue by dispatch.`],
        FAILED: ["FAILED", "Delivery marked failed", `${delivery.trackingCode} was marked failed by dispatch (${failureReasonLabel(failureReason)}).`],
        DELIVERED: ["DELIVERED", "Delivery marked delivered", `${delivery.trackingCode} was marked delivered by dispatch.`],
      };
      const m = driverMsgs[toStatus];
      if (m) {
        await bestEffort("status: driver notification", () =>
          notifyInApp({ userId: closedDriver.id, type: m[0], title: m[1], body: m[2], deliveryId: delivery.id })
        );
      }
    }
    if (user.role === "DRIVER") {
      const labels: Record<string, [string, string]> = {
        PICKED_UP: ["Pickup confirmed", `${delivery.trackingCode} has been picked up by ${user.name}.`],
        IN_TRANSIT: ["Delivery in transit", `${delivery.trackingCode} is on the way with ${user.name}.`],
        DELIVERED: ["Delivery completed", `${delivery.trackingCode} was delivered — proof of delivery recorded.`],
        FAILED: ["Delivery attempt failed", `${delivery.trackingCode} failed: ${reasonText}. Reassign or reschedule.`],
      };
      const l = labels[toStatus];
      if (l) {
        await bestEffort("status: admin notification", async () => {
          const emailDedupeKey = toStatus === "DELIVERED" || toStatus === "FAILED" ? await outcomeEventKey() : undefined;
          await notifyAdmins(
            user.organizationId,
            { type: toStatus, title: l[0], body: l[1], deliveryId: delivery.id },
            { email: !!emailDedupeKey, emailDedupeKey }
          );
        });
      }
    }

    // the recipient hears about the outcome (neutral wording for failures), whoever set it
    if (toStatus === "DELIVERED" || toStatus === "FAILED") {
      await bestEffort("status: customer email", async () =>
        sendCustomerOutcomeEmail({
          organizationId: user.organizationId,
          delivery,
          outcome: toStatus,
          eventKey: await outcomeEventKey(),
        })
      );
    }

    return ok({ success: true, from, to: toStatus });
  } catch (e) {
    return fail(e);
  }
}
