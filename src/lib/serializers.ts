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
}

export interface DeliveryDTO {
  id: string;
  trackingCode: string;
  trackingToken: string | null;
  trackingEnabled: boolean;
  recipientName: string;
  recipientPhone: string;
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
}

type DeliveryWithRefs = Delivery & {
  assignments: (Assignment & { driver: User; vehicle: Vehicle | null })[];
  _count?: { pods: number };
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
