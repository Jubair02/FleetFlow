import { Prisma, type Delivery } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { assertPlanLimit } from "@/lib/plans";
import { TX_OPTIONS, closeAssignment, generateTrackingCode, generateTrackingToken, lockDelivery, table } from "@/lib/delivery";
import { auditData, bestEffort, notifyInApp, sendCustomerTrackingEmail } from "@/lib/notify";
import { queueDeliveryStatusChange, queueWebhookEvent, dispatchWebhooksSoon, deliveryLoader } from "@/lib/webhooks";
import { geocodeDeliveriesSoon, pointData } from "@/lib/geocoding";
import { chargeFor } from "@/lib/zone-service";
import { NEW_DELIVERY_STATE } from "@/lib/zones";
import type { z } from "zod";
import type { createDeliverySchema } from "@/lib/validation";

/** Staff may also pick the zone / type the fee (createStaffDeliverySchema); the public API can't. */
export type CreateDeliveryInput = z.output<typeof createDeliverySchema> & { zoneId?: string | null; deliveryFeeBdt?: number | null };

// ─────────────────────────────────────────────────────────────
// Delivery operations shared by the in-app API (/api/deliveries) and the
// public API (/api/v1/deliveries): same validation input, plan limit,
// read-only (402) check, tracking token, customer notifications, audit
// trail and webhook events.
// ─────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

/** Who is acting: a signed-in user, or an API key ("API: <key name>", no user id). */
export interface DeliveryActor {
  organizationId: string;
  actorId: string | null;
  actorName: string;
}

const MAX_CREATE_ATTEMPTS = 5;

/** True when a unique-constraint error was caused by a tracking code/token collision. */
export function isTrackingCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return /trackingCode|trackingToken/i.test(fields);
}

/** Lock the organization row for the rest of the transaction (serializes creates per company). */
export async function lockOrganization(tx: Tx, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ${table("Organization")} WHERE id = ${organizationId} FOR UPDATE`;
  if (!rows.length) throw new ApiError(404, "Organization not found");
}

export interface CreateDeliveryOptions {
  /**
   * Idempotency hook: runs inside the transaction once the organization row
   * is locked (so concurrent retries are serialized) and BEFORE the plan
   * checks. Return an existing delivery id to skip creating a new one.
   */
  findExisting?: (tx: Tx) => Promise<string | null>;
  /** Extra fields for the DELIVERY_CREATED audit row (e.g. the API key). */
  auditDetail?: Record<string, unknown>;
  /**
   * Where the delivery goes, when the caller knows (staff pin → PIN, public
   * API `location` → API; validate with parseDeliveryPoint). Without it the
   * address is geocoded after the response (src/lib/geocoding.ts).
   */
  point?: { lat: number; lng: number; source: "PIN" | "API" } | null;
}

export interface CreateDeliveryResult {
  delivery: Delivery;
  /** false = an existing delivery was returned by findExisting. */
  created: boolean;
}

/**
 * Create a delivery: plan limit + read-only check, tracking code/token
 * (retried on collision), CREATED event, audit row and delivery.created
 * webhook in one transaction; then the customer tracking email/SMS and
 * webhook dispatch, best effort.
 */
export async function createDelivery(
  actor: DeliveryActor,
  data: CreateDeliveryInput,
  opts: CreateDeliveryOptions = {}
): Promise<CreateDeliveryResult> {
  const { organizationId } = actor;
  // A tracking code/token collision aborts the whole Postgres transaction,
  // so on P2002 the entire create is retried with freshly generated values.
  const createOnce = () =>
    db.$transaction(async (tx): Promise<CreateDeliveryResult> => {
      if (opts.findExisting) {
        await lockOrganization(tx, organizationId);
        const existingId = await opts.findExisting(tx);
        if (existingId) return { delivery: await tx.delivery.findUniqueOrThrow({ where: { id: existingId } }), created: false };
      }
      await assertPlanLimit(tx, organizationId, "monthlyDeliveries");
      // Zone + delivery charge (src/lib/zones.ts)
      const charge = await chargeFor(tx, organizationId, NEW_DELIVERY_STATE, {
        deliveryAddress: data.deliveryAddress,
        weightKg: data.weightKg ?? null,
        codAmount: data.codAmount || null,
        zoneId: data.zoneId ?? null,
        deliveryFeeBdt: data.deliveryFeeBdt ?? undefined,
      });
      const created = await tx.delivery.create({
        data: {
          organizationId,
          trackingCode: generateTrackingCode(),
          trackingToken: generateTrackingToken(),
          recipientName: data.recipientName,
          recipientPhone: data.recipientPhone,
          pickupAddress: data.pickupAddress,
          deliveryAddress: data.deliveryAddress,
          instructions: data.instructions || null,
          externalRef: data.externalRef || null,
          recipientEmail: data.recipientEmail || null,
          priority: data.priority,
          expectedAt: data.expectedAt ? new Date(data.expectedAt) : null,
          codAmount: data.codAmount ? data.codAmount : null,
          weightKg: data.weightKg ?? null,
          ...charge,
          ...(opts.point ? pointData(opts.point, opts.point.source) : {}),
        },
      });
      await tx.deliveryEvent.create({
        data: {
          deliveryId: created.id,
          eventType: "CREATED",
          actorId: actor.actorId,
          actorName: actor.actorName,
          note: "Delivery created",
          customerVisible: true,
        },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId,
          actorId: actor.actorId,
          actorName: actor.actorName,
          action: "DELIVERY_CREATED",
          entityType: "Delivery",
          entityId: created.id,
          detail: { trackingCode: created.trackingCode, recipient: data.recipientName, ...opts.auditDetail },
        }),
      });
      await queueWebhookEvent(tx, organizationId, "delivery.created", async () => ({ delivery: await deliveryLoader(tx, created.id)() }));
      return { delivery: created, created: true };
    }, TX_OPTIONS);

  let result: CreateDeliveryResult | null = null;
  for (let attempt = 1; !result; attempt++) {
    try {
      result = await createOnce();
    } catch (e) {
      if (attempt < MAX_CREATE_ATTEMPTS && isTrackingCollision(e)) continue;
      throw e;
    }
  }

  if (result.created) {
    const created = result.delivery;
    await bestEffort("customer tracking email", () =>
      sendCustomerTrackingEmail({
        organizationId,
        deliveryId: created.id,
        trackingCode: created.trackingCode,
        trackingToken: created.trackingToken,
        recipientName: created.recipientName,
        recipientEmail: created.recipientEmail,
      })
    );
    dispatchWebhooksSoon(organizationId);
    if (created.deliveryLat === null) geocodeDeliveriesSoon([created.id]);
  }
  return result;
}

/** Statuses a delivery can be cancelled from without an override (same as the app's admin path). */
export const CANCELLABLE_STATUSES = ["CREATED", "FAILED"] as const;

export interface CancelResult {
  delivery: Delivery;
  /** false = it was already cancelled; nothing changed. */
  changed: boolean;
}

/**
 * Cancel a pending or failed delivery with a reason — the same rule as the
 * app's non-override cancel. In-flight and delivered deliveries need a
 * dispatcher (override) in the app.
 */
export async function cancelDelivery(actor: DeliveryActor, deliveryId: string, reason: string): Promise<CancelResult> {
  const note = reason.trim();
  if (!note) throw new ApiError(400, "A cancellation reason is required");
  const result = await db.$transaction(async (tx) => {
    await lockDelivery(tx, deliveryId, actor.organizationId);
    const delivery = await tx.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: { assignments: { where: { active: true }, include: { driver: { select: { id: true } } } } },
    });
    if (delivery.status === "CANCELLED") return { delivery, changed: false, closedDriverId: null };
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(delivery.status)) {
      throw new ApiError(
        409,
        `Delivery is ${delivery.status.toLowerCase().replace("_", " ")} — only pending or failed deliveries can be cancelled. Ask your dispatcher to cancel it in FleetFlow.`
      );
    }
    const updated = await tx.delivery.update({ where: { id: delivery.id }, data: { status: "CANCELLED", failureReason: null } });
    // A failed delivery's assignment is already closed; this is a safety net.
    const active = delivery.assignments[0] ?? null;
    if (active) await closeAssignment(tx, active, "CANCELLED");
    await tx.deliveryEvent.create({
      data: {
        deliveryId: delivery.id,
        eventType: "CANCELLED",
        actorId: actor.actorId,
        actorName: actor.actorName,
        note,
        customerVisible: true,
      },
    });
    await tx.auditLog.create({
      data: auditData({
        organizationId: actor.organizationId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "STATUS_CANCELLED",
        entityType: "Delivery",
        entityId: delivery.id,
        detail: { trackingCode: delivery.trackingCode, from: delivery.status, to: "CANCELLED", reason: note },
      }),
    });
    await queueDeliveryStatusChange(tx, actor.organizationId, delivery.id, delivery.status, "CANCELLED");
    return { delivery: updated, changed: true, closedDriverId: active?.driverId ?? null };
  }, TX_OPTIONS);

  if (result.changed) {
    const { delivery, closedDriverId } = result;
    if (closedDriverId) {
      await bestEffort("cancel: driver notification", () =>
        notifyInApp({ userId: closedDriverId, type: "UNASSIGNED", title: "Delivery cancelled", body: `${delivery.trackingCode} was cancelled.`, deliveryId: delivery.id })
      );
    }
    dispatchWebhooksSoon(actor.organizationId);
  }
  return { delivery: result.delivery, changed: result.changed };
}
