import { randomBytes, randomInt } from "crypto";
import { db } from "@/lib/db";
import type { Delivery } from "@prisma/client";

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

/** Delivery row → safe public snapshot fields for the tracking API. */
export function publicTimelineEvents(events: { eventType: string; createdAt: Date; note: string | null; customerVisible: boolean }[]) {
  return events
    .filter((e) => e.customerVisible)
    .map((e) => ({ eventType: e.eventType, note: e.note, timestamp: e.createdAt.toISOString() }));
}

export function isLateDelivery(d: Pick<Delivery, "completedAt" | "expectedAt">): boolean {
  return !!(d.completedAt && d.expectedAt && d.completedAt > d.expectedAt);
}
