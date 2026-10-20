import { z } from "zod";
import { DELIVERY_STATUSES, PRIORITIES, DRIVER_AVAILABILITY, VEHICLE_TYPES, VEHICLE_STATUSES, FAILURE_REASONS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────
// Zod request schemas — validate every write at the boundary
// ─────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const createDeliverySchema = z.object({
  recipientName: z.string().trim().min(2, "Recipient name is required").max(120),
  recipientPhone: z.string().trim().min(6, "Contact number is required").max(30),
  pickupAddress: z.string().trim().min(5, "Pickup address is required").max(300),
  deliveryAddress: z.string().trim().min(5, "Delivery address is required").max(300),
  instructions: z.string().trim().max(500).optional().or(z.literal("")),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  expectedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const updateDeliverySchema = createDeliverySchema.partial();

export const assignSchema = z.object({
  driverId: z.string().min(1, "Select a driver"),
  vehicleId: z.string().min(1, "Select a vehicle"),
});

export const unassignSchema = z.object({
  reason: z.string().trim().max(300).optional().or(z.literal("")),
});

export const statusChangeSchema = z.object({
  status: z.enum(DELIVERY_STATUSES),
  note: z.string().trim().max(500).optional().or(z.literal("")),
  failureReason: z.enum(FAILURE_REASONS.map((r) => r.code) as [string, ...string[]]).optional(),
  recipientName: z.string().trim().max(120).optional(), // for POD on DELIVERED
});

export const noteSchema = z.object({
  note: z.string().trim().min(1, "Note text is required").max(500),
  customerVisible: z.boolean().default(false),
});

export const trackingActionSchema = z.object({
  action: z.enum(["regenerate", "revoke", "restore"]),
});

export const createDriverSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().trim().min(6, "Phone is required").max(30),
  licenseNumber: z.string().trim().min(3, "License number is required").max(40),
  maxActiveJobs: z.coerce.number().int().min(1).max(10).default(3),
});

export const updateDriverSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  licenseNumber: z.string().trim().min(3).max(40).optional(),
  availability: z.enum(DRIVER_AVAILABILITY).optional(),
  maxActiveJobs: z.coerce.number().int().min(1).max(10).optional(),
  active: z.boolean().optional(),
});

export const createVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(3, "Registration number is required").max(20),
  type: z.enum(VEHICLE_TYPES),
  capacity: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});

export const updateVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(3).max(20).optional(),
  type: z.enum(VEHICLE_TYPES).optional(),
  capacity: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  status: z.enum(VEHICLE_STATUSES).optional(),
});

export function firstError(zodError: z.ZodError): string {
  return zodError.issues[0]?.message ?? "Invalid input";
}
