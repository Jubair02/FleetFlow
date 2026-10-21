// ─────────────────────────────────────────────────────────────
// FleetFlow domain constants — shared by API and UI
// ─────────────────────────────────────────────────────────────

export const DELIVERY_STATUSES = [
  "CREATED",
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const VEHICLE_TYPES = ["VAN", "BOX_TRUCK", "MOTORCYCLE", "CAR", "REFRIGERATED"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ["ACTIVE", "MAINTENANCE", "INACTIVE"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const DRIVER_AVAILABILITY = ["AVAILABLE", "ON_ROUTE", "OFF_DUTY"] as const;
export type DriverAvailability = (typeof DRIVER_AVAILABILITY)[number];

export const FAILURE_REASONS = [
  { code: "RECIPIENT_UNAVAILABLE", label: "Recipient not available" },
  { code: "WRONG_ADDRESS", label: "Address not found or incorrect" },
  { code: "RECIPIENT_REFUSED", label: "Recipient refused delivery" },
  { code: "PACKAGE_DAMAGED", label: "Package damaged" },
  { code: "VEHICLE_ISSUE", label: "Vehicle breakdown" },
  { code: "OTHER", label: "Other (add internal note)" },
] as const;
export type FailureReasonCode = (typeof FAILURE_REASONS)[number]["code"];

export function failureReasonLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  // Drop form hints like "(add internal note)" — this label is for display.
  return FAILURE_REASONS.find((r) => r.code === code)?.label.replace(/\s*\(.*\)$/, "") ?? code;
}

// Statuses that mean "driver is actively working on it"
export const ACTIVE_JOB_STATUSES: DeliveryStatus[] = ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"];
// Terminal statuses
export const TERMINAL_STATUSES: DeliveryStatus[] = ["DELIVERED", "CANCELLED"];

// ── Delivery state machine ───────────────────────────────────
// Explicit transitions. Everything not listed is invalid.

/** Transitions a DRIVER may perform on a delivery actively assigned to them. */
export const DRIVER_TRANSITIONS: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  ASSIGNED: ["PICKED_UP", "FAILED"],
  PICKED_UP: ["IN_TRANSIT", "FAILED"],
  IN_TRANSIT: ["DELIVERED", "FAILED"],
};

/** Transitions an ADMIN/DISPATCHER may perform directly (non-override path). */
export const ADMIN_TRANSITIONS: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  CREATED: ["CANCELLED"],
  FAILED: ["CANCELLED"],
};

export function isValidDriverTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DRIVER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isValidAdminTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return ADMIN_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Driver read access ───────────────────────────────────────

interface AssignmentAccessRow {
  driverId: string;
  active: boolean;
  outcome: string | null;
  assignedAt: Date;
}

/**
 * A driver may read a delivery while they hold its active assignment, for good
 * once they delivered it, and after a failed/cancelled attempt only until it is
 * reassigned — so they never see the next driver's details, notes or proof.
 */
export function driverCanReadDelivery(assignments: AssignmentAccessRow[], driverId: string): boolean {
  if (assignments.some((a) => a.driverId === driverId && (a.active || a.outcome === "DELIVERED"))) return true;
  const latest = assignments.reduce<AssignmentAccessRow | null>((acc, a) => (!acc || a.assignedAt > acc.assignedAt ? a : acc), null);
  return !!latest && latest.driverId === driverId && (latest.outcome === "FAILED" || latest.outcome === "CANCELLED");
}

// ── Labels for UI ────────────────────────────────────────────

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  CREATED: "Pending assignment",
  ASSIGNED: "Assigned",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** Customer-safe labels for the public tracking page. */
export const PUBLIC_STATUS_LABELS: Record<DeliveryStatus, string> = {
  CREATED: "Order received",
  ASSIGNED: "Courier assigned",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "On the way",
  DELIVERED: "Delivered",
  FAILED: "Attempt unsuccessful",
  CANCELLED: "Cancelled",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  VAN: "Van",
  BOX_TRUCK: "Box truck",
  MOTORCYCLE: "Motorcycle",
  CAR: "Car",
  REFRIGERATED: "Refrigerated",
};

export const AVAILABILITY_LABELS: Record<DriverAvailability, string> = {
  AVAILABLE: "Available",
  ON_ROUTE: "On route",
  OFF_DUTY: "Off duty",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  CREATED: "Created",
  ASSIGNED: "Assigned",
  UNASSIGNED: "Unassigned",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  NOTE: "Note",
  CANCELLED: "Cancelled",
  TRACKING_UPDATED: "Tracking link",
  OVERRIDE: "Override",
};
