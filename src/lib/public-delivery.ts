import type { Delivery, Prisma } from "@prisma/client";
import { failureReasonLabel } from "@/lib/constants";
import { trackingUrl } from "@/lib/email/templates";

// ─────────────────────────────────────────────────────────────
// The delivery as the public API and webhooks show it (docs/API.md).
// A stable contract: add fields, never rename or remove them.
//
// Deliberately left out: internal notes and the event history, the raw
// tracking token (trackingUrl already carries it), the driver's phone,
// email and ids, vehicle details, import batch and cash-settlement
// internals. The assigned driver's display name is included so a store
// can tell its customer who is coming.
// ─────────────────────────────────────────────────────────────

export interface PublicDelivery {
  id: string;
  trackingCode: string;
  /** Public tracking page; null while tracking is turned off for this delivery. */
  trackingUrl: string | null;
  externalRef: string | null;
  status: string;
  priority: string;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string | null;
  pickupAddress: string;
  deliveryAddress: string;
  instructions: string | null;
  expectedAt: string | null;
  completedAt: string | null;
  /** Failure reason code (see docs/API.md) while status is FAILED. */
  failureReason: string | null;
  failureReasonLabel: string | null;
  /** Cash on delivery in whole BDT; null = prepaid. */
  codAmount: number | null;
  codCollectedAmount: number | null;
  codCollectedAt: string | null;
  /** Parcel weight in kg; null = not given. */
  weightKg: number | null;
  /** Delivery charge in whole BDT (docs/ZONES.md); null = not priced. */
  deliveryFeeBdt: number | null;
  /** Delivery zone the charge comes from; null = no zone. */
  zone: { name: string } | null;
  driver: { name: string; assignedAt: string } | null;
  /** The delivery's place in the driver's planned route (docs/ROUTES.md); null when not planned. eta is an estimate. */
  route: { stop: number; eta: string | null } | null;
  /**
   * Where the delivery goes on the map (docs/MAPS.md); null until known.
   * source: API (you sent it) | PIN (dropped by staff) | GEOCODED (looked up
   * from the address) | DRIVER (GPS at proof of delivery).
   */
  location: { lat: number; lng: number; source: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

type PublicDeliverySource = Pick<
  Delivery,
  | "id"
  | "trackingCode"
  | "trackingToken"
  | "trackingEnabled"
  | "externalRef"
  | "status"
  | "priority"
  | "recipientName"
  | "recipientPhone"
  | "recipientEmail"
  | "pickupAddress"
  | "deliveryAddress"
  | "instructions"
  | "expectedAt"
  | "completedAt"
  | "failureReason"
  | "codAmount"
  | "codCollectedAmount"
  | "codCollectedAt"
  | "createdAt"
  | "updatedAt"
> &
  Partial<Pick<Delivery, "routeSeq" | "plannedEta">> &
  Partial<Pick<Delivery, "weightKg" | "deliveryFeeBdt">> &
  Partial<Pick<Delivery, "deliveryLat" | "deliveryLng" | "geoSource">> & {
  /** Active assignments (only the active one is shown). */
  assignments?: { active: boolean; assignedAt: Date; driver: { name: string } }[];
  zone?: { name: string } | null;
};

/** Include for queries whose result is passed to toPublicDelivery. */
export const PUBLIC_DELIVERY_INCLUDE = {
  assignments: { where: { active: true }, select: { active: true, assignedAt: true, driver: { select: { name: true } } } },
  zone: { select: { name: true } },
} satisfies Prisma.DeliveryInclude;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toPublicDelivery(d: PublicDeliverySource): PublicDelivery {
  const active = d.assignments?.find((a) => a.active) ?? null;
  return {
    id: d.id,
    trackingCode: d.trackingCode,
    trackingUrl: d.trackingEnabled ? trackingUrl(d.trackingToken) : null,
    externalRef: d.externalRef ?? null,
    status: d.status,
    priority: d.priority,
    recipientName: d.recipientName,
    recipientPhone: d.recipientPhone,
    recipientEmail: d.recipientEmail ?? null,
    pickupAddress: d.pickupAddress,
    deliveryAddress: d.deliveryAddress,
    instructions: d.instructions || null,
    expectedAt: iso(d.expectedAt),
    completedAt: iso(d.completedAt),
    failureReason: d.status === "FAILED" ? d.failureReason || "OTHER" : null,
    failureReasonLabel: d.status === "FAILED" ? failureReasonLabel(d.failureReason || "OTHER") : null,
    codAmount: d.codAmount ?? null,
    codCollectedAmount: d.codCollectedAmount ?? null,
    codCollectedAt: iso(d.codCollectedAt),
    weightKg: d.weightKg ?? null,
    deliveryFeeBdt: d.deliveryFeeBdt ?? null,
    zone: d.zone ? { name: d.zone.name } : null,
    driver: active ? { name: active.driver.name, assignedAt: active.assignedAt.toISOString() } : null,
    route: d.routeSeq != null ? { stop: d.routeSeq, eta: iso(d.plannedEta) } : null,
    location: d.deliveryLat != null && d.deliveryLng != null ? { lat: d.deliveryLat, lng: d.deliveryLng, source: d.geoSource ?? null } : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
