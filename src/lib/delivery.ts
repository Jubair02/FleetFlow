import { randomBytes, randomInt } from "crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { Prisma } from "@prisma/client";
import type { Assignment, Delivery } from "@prisma/client";

// Unambiguous alphabet for tracking codes (no 0/O/1/I)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Human-friendly internal tracking code, e.g. FF-250612-K7QX */
export function generateTrackingCode(): string {
  const d = new Date();
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `FF-${date}-${suffix}`;
}

/** Unguessable public tracking token (48 hex chars ≈ 192 bits of entropy). */
export function generateTrackingToken(): string {
  return randomBytes(24).toString("hex");
}

export interface EventInput {
  deliveryId: string;
  eventType: string;
  note?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  customerVisible?: boolean;
  createdAt?: Date;
}

/** Append an immutable event to a delivery's history. Never update/delete. */
export async function addEvent(input: EventInput) {
  return db.deliveryEvent.create({
    data: {
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      note: input.note ?? null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      customerVisible: input.customerVisible ?? false,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

export function isLateDelivery(d: Pick<Delivery, "completedAt" | "expectedAt">): boolean {
  return !!(d.completedAt && d.expectedAt && d.completedAt > d.expectedAt);
}

// ─────────────────────────────────────────────────────────────
// Transaction helpers — Postgres runs at READ COMMITTED, so every
// lifecycle mutation takes row locks before its check-then-write.
// Lock order is always Delivery → DriverProfile → Vehicle.
// ─────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

// Raw SQL must name the schema explicitly: behind a transaction-mode pooler
// (Neon/PgBouncer) the per-connection search_path isn't reliable.
const DB_SCHEMA = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema") || "public";
  } catch {
    return "public";
  }
})();

/** Schema-qualified table name for raw SQL. */
export function table(name: string): Prisma.Sql {
  return Prisma.raw(`"${DB_SCHEMA.replace(/"/g, '""')}"."${name}"`);
}

/** Interactive-transaction options sized for a remote (Neon) database. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/** Lock a delivery row for the rest of the transaction (404 if not in org). */
export async function lockDelivery(tx: Tx, id: string, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ${table("Delivery")} WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
  if (!rows.length) throw new ApiError(404, "Delivery not found");
}

/** Lock a driver's profile row (serializes capacity/availability changes). */
export async function lockDriver(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM ${table("DriverProfile")} WHERE "userId" = ${userId} FOR UPDATE`;
}

/** Lock a vehicle row (serializes in-use/status changes). */
export async function lockVehicle(tx: Tx, vehicleId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM ${table("Vehicle")} WHERE id = ${vehicleId} FOR UPDATE`;
}

/** Derive ON_ROUTE/AVAILABLE from the driver's active jobs. OFF_DUTY is left alone. */
export async function syncDriverAvailability(tx: Tx, driverId: string): Promise<void> {
  const active = await tx.assignment.count({ where: { driverId, active: true } });
  if (active > 0) {
    await tx.driverProfile.updateMany({ where: { userId: driverId, availability: "AVAILABLE" }, data: { availability: "ON_ROUTE" } });
  } else {
    await tx.driverProfile.updateMany({ where: { userId: driverId, availability: "ON_ROUTE" }, data: { availability: "AVAILABLE" } });
  }
}

export type AssignmentOutcome = "DELIVERED" | "FAILED" | "CANCELLED" | "UNASSIGNED";

/**
 * Close an active assignment with a recorded outcome and resync the
 * driver's availability. Caller must already hold the delivery lock.
 */
export async function closeAssignment(tx: Tx, assignment: Pick<Assignment, "id" | "driverId">, outcome: AssignmentOutcome, now = new Date()): Promise<void> {
  await lockDriver(tx, assignment.driverId);
  const res = await tx.assignment.updateMany({
    where: { id: assignment.id, active: true },
    data: {
      active: false,
      outcome,
      ...(outcome === "DELIVERED" ? { completedAt: now } : { unassignedAt: now }),
    },
  });
  if (res.count !== 1) throw new ApiError(409, "The assignment was changed by someone else — refresh and retry");
  await clearRouteStop(tx, assignment);
  await syncDriverAvailability(tx, assignment.driverId);
}

/**
 * The delivery left the driver's route (unassigned, delivered, failed,
 * cancelled): clear its stop number and estimate, and close the gap so the
 * driver's remaining stops stay numbered 1, 2, 3… (src/lib/route-service.ts).
 * The driver's profile lock (held by closeAssignment) serializes this with
 * route planning.
 */
async function clearRouteStop(tx: Tx, assignment: Pick<Assignment, "id" | "driverId">): Promise<void> {
  const delivery = await tx.delivery.findFirst({
    where: { assignments: { some: { id: assignment.id } } },
    select: { id: true, routeSeq: true, routePlannedAt: true, plannedEta: true },
  });
  if (!delivery || (delivery.routeSeq == null && !delivery.routePlannedAt && !delivery.plannedEta)) return;
  await tx.delivery.update({ where: { id: delivery.id }, data: { routeSeq: null, routePlannedAt: null, plannedEta: null } });
  if (delivery.routeSeq == null) return;
  await tx.delivery.updateMany({
    where: {
      id: { not: delivery.id },
      routeSeq: { gt: delivery.routeSeq },
      assignments: { some: { driverId: assignment.driverId, active: true } },
    },
    data: { routeSeq: { decrement: 1 } },
  });
}

// ── Cash on delivery ─────────────────────────────────────────

/**
 * Fields to write when a COD delivery is completed: the cash the driver
 * actually collected (it may differ from codAmount — short payments show up
 * in the COD report). Prepaid deliveries need nothing.
 */
export function codCompletionData(
  delivery: Pick<Delivery, "codAmount">,
  collected: number | undefined,
  driverId: string | null,
  now: Date
): Prisma.DeliveryUncheckedUpdateInput {
  if (!delivery.codAmount) return {};
  if (collected === undefined) {
    throw new ApiError(400, `Enter the cash collected — ৳${delivery.codAmount.toLocaleString("en-US")} is due on this delivery`);
  }
  return { codCollectedAmount: collected, codCollectedAt: now, codCollectedById: driverId };
}

/**
 * Fields to clear when a delivered COD delivery is reopened. Cash already
 * handed over to the office can't be un-collected, so that is refused.
 */
export function codReopenData(delivery: Pick<Delivery, "codCollectedAt" | "codSettlementId">): Prisma.DeliveryUncheckedUpdateInput {
  if (!delivery.codCollectedAt) return {};
  if (delivery.codSettlementId) {
    throw new ApiError(409, "The cash for this delivery was already handed over to the office — it can't be reopened");
  }
  return { codCollectedAmount: null, codCollectedAt: null, codCollectedById: null };
}
