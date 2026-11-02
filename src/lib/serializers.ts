import type { Delivery, User, Vehicle, Assignment, DriverProfile } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// DTO mappers — canonical API shapes shared with the frontend
// (frontend mirror: src/lib/types.ts)
// ─────────────────────────────────────────────────────────────

export interface AssignmentDTO {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehicleRegistration: string;
  vehicleType: string;
  assignedAt: string;
  unassignedAt: string | null;
  completedAt: string | null;
  active: boolean;
  /** Set when closed: DELIVERED | FAILED | CANCELLED | UNASSIGNED */
  outcome: string | null;
}

export interface DeliveryDTO {
  id: string;
  trackingCode: string;
  trackingToken: string | null;
  trackingEnabled: boolean;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string | null;
  externalRef: string | null;
  pickupAddress: string;
  deliveryAddress: string;
  instructions: string | null;
  priority: string;
  status: string;
  expectedAt: string | null;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Cash on delivery (whole BDT); null = prepaid. */
  codAmount: number | null;
  codCollectedAmount: number | null;
  codCollectedAt: string | null;
  /** True once the collected cash was handed over to the office. */
  codSettled: boolean;
  /** Stop number in the assigned driver's planned route (1 = first); null = not planned. */
  routeSeq: number | null;
  /** Planned arrival estimate (docs/ROUTES.md); null = not planned / no map location. */
  plannedEta: string | null;
  assignment: {
    id: string;
    driverId: string;
    driverName: string;
    vehicleId: string;
    vehicleRegistration: string;
    vehicleType: string;
    assignedAt: string;
  } | null;
  podCount: number;
  /** Map point and who set it (GEOCODED | PIN | DRIVER | API); null = not located yet. */
  location: { lat: number; lng: number; source: string | null } | null;
  /** Delivery charge (docs/ZONES.md) — staff views only; null for drivers. */
  charge: DeliveryChargeDTO | null;
  /** Customer rating + reschedule request from the tracking page — staff views only; null for drivers. */
  customer: DeliveryCustomerFeedbackDTO | null;
}

/** docs/CUSTOMER-EXPERIENCE.md */
export interface DeliveryCustomerFeedbackDTO {
  rating: { score: number; comment: string | null; ratedAt: string | null } | null;
  reschedule: {
    status: string;
    /** Start of the requested day / window (ISO). */
    requestedFor: string | null;
    window: string | null;
    note: string | null;
    requestedAt: string | null;
    resolvedAt: string | null;
  } | null;
}

export interface DeliveryChargeDTO {
  zoneId: string | null;
  /** null when the zone was deleted or the query didn't load it. */
  zoneName: string | null;
  weightKg: number | null;
  /** Whole BDT; null = no zone matched / no price. */
  deliveryFeeBdt: number | null;
  /** True = typed by staff, never recalculated. */
  feeOverridden: boolean;
}

/** Include for queries whose rows go to toDeliveryDTO (the zone's name). */
export const DELIVERY_ZONE_INCLUDE = { zone: { select: { name: true } } } as const;

type DeliveryWithRefs = Delivery & {
  assignments: (Assignment & { driver: User; vehicle: Vehicle | null })[];
  _count?: { pods: number };
  zone?: { name: string } | null;
};

export function toDeliveryDTO(d: DeliveryWithRefs, includeToken: boolean): DeliveryDTO {
  const active = d.assignments.find((a) => a.active) ?? null;
  return {
    id: d.id,
    trackingCode: d.trackingCode,
    trackingToken: includeToken ? d.trackingToken : null,
    trackingEnabled: d.trackingEnabled,
    recipientName: d.recipientName,
    recipientPhone: d.recipientPhone,
    recipientEmail: d.recipientEmail,
    externalRef: d.externalRef,
    pickupAddress: d.pickupAddress,
    deliveryAddress: d.deliveryAddress,
    instructions: d.instructions || null,
    priority: d.priority,
    status: d.status,
    expectedAt: d.expectedAt ? d.expectedAt.toISOString() : null,
    failureReason: d.failureReason || null,
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    codAmount: d.codAmount,
    codCollectedAmount: d.codCollectedAmount,
    codCollectedAt: d.codCollectedAt ? d.codCollectedAt.toISOString() : null,
    codSettled: !!d.codSettlementId,
    routeSeq: d.routeSeq ?? null,
    plannedEta: d.plannedEta ? d.plannedEta.toISOString() : null,
    assignment:
      active && active.vehicle
        ? {
            id: active.id,
            driverId: active.driverId,
            driverName: active.driver.name,
            vehicleId: active.vehicleId,
            vehicleRegistration: active.vehicle.registrationNumber,
            vehicleType: active.vehicle.type,
            assignedAt: active.assignedAt.toISOString(),
          }
        : null,
    podCount: d._count?.pods ?? 0,
    location: d.deliveryLat != null && d.deliveryLng != null ? { lat: d.deliveryLat, lng: d.deliveryLng, source: d.geoSource ?? null } : null,
    charge: includeToken
      ? { zoneId: d.zoneId, zoneName: d.zone?.name ?? null, weightKg: d.weightKg, deliveryFeeBdt: d.deliveryFeeBdt, feeOverridden: d.feeOverridden }
      : null,
    customer: includeToken
      ? {
          rating: d.rating != null ? { score: d.rating, comment: d.ratingComment ?? null, ratedAt: d.ratedAt?.toISOString() ?? null } : null,
          reschedule: d.rescheduleStatus
            ? {
                status: d.rescheduleStatus,
                requestedFor: d.rescheduleRequestedFor?.toISOString() ?? null,
                window: d.rescheduleWindow ?? null,
                note: d.rescheduleNote ?? null,
                requestedAt: d.rescheduleRequestedAt?.toISOString() ?? null,
                resolvedAt: d.rescheduleResolvedAt?.toISOString() ?? null,
              }
            : null,
        }
      : null,
  };
}

export function toAssignmentDTO(a: Assignment & { driver: User; vehicle: Vehicle | null }): AssignmentDTO {
  return {
    id: a.id,
    driverId: a.driverId,
    driverName: a.driver.name,
    vehicleId: a.vehicleId,
    vehicleRegistration: a.vehicle?.registrationNumber ?? "—",
    vehicleType: a.vehicle?.type ?? "—",
    assignedAt: a.assignedAt.toISOString(),
    unassignedAt: a.unassignedAt ? a.unassignedAt.toISOString() : null,
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    active: a.active,
    outcome: a.outcome ?? null,
  };
}

export interface DriverDTO {
  id: string;
  name: string;
  email: string;
  active: boolean;
  phone: string;
  licenseNumber: string;
  availability: string;
  maxActiveJobs: number;
  activeJobs: number;
  completedTotal: number;
  failedTotal: number;
}

export function toDriverDTO(user: User & { driverProfile: DriverProfile | null; _count?: { assignments: number } }, activeJobs = 0, completedTotal = 0, failedTotal = 0): DriverDTO | null {
  if (!user.driverProfile) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    active: user.active,
    phone: user.driverProfile.phone,
    licenseNumber: user.driverProfile.licenseNumber,
    availability: user.driverProfile.availability,
    maxActiveJobs: user.driverProfile.maxActiveJobs,
    activeJobs,
    completedTotal,
    failedTotal,
  };
}
