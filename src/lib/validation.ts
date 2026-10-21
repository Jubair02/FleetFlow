import { z } from "zod";
import { isValidTimezone } from "@/lib/timezone";
import { DELIVERY_STATUSES, PRIORITIES, DRIVER_AVAILABILITY, VEHICLE_TYPES, VEHICLE_STATUSES, FAILURE_REASONS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────
// Zod request schemas — validate every write at the boundary
// ─────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email").max(254),
  password: z.string().min(1, "Password is required").max(200),
});

export const createDeliverySchema = z.object({
  recipientName: z.string().trim().min(2, "Recipient name is required").max(120),
  recipientPhone: z.string().trim().min(6, "Contact number is required").max(30),
  pickupAddress: z.string().trim().min(5, "Pickup address is required").max(300),
  deliveryAddress: z.string().trim().min(5, "Delivery address is required").max(300),
  instructions: z.string().trim().max(500).optional().or(z.literal("")),
  externalRef: z.string().trim().max(64, "Order reference must be at most 64 characters").optional().or(z.literal("")),
  recipientEmail: z.string().trim().toLowerCase().email("Enter a valid customer email").max(254).optional().or(z.literal("")),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  expectedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

// Explicit .optional() on priority: zod 4 still applies .default() inside .partial(),
// which would silently reset priority to NORMAL on every edit.
export const updateDeliverySchema = createDeliverySchema.extend({ priority: z.enum(PRIORITIES).optional() }).partial();

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
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  phone: z.string().trim().min(6, "Phone is required").max(30),
  licenseNumber: z.string().trim().min(3, "License number is required").max(40),
  maxActiveJobs: z.coerce.number().int().min(1).max(10).default(3),
});

// ON_ROUTE is derived from active jobs on the server; admins only toggle duty.
export const updateDriverSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120).optional(),
  phone: z.string().trim().min(6, "Phone must be at least 6 characters").max(30).optional(),
  licenseNumber: z.string().trim().min(3, "License number must be at least 3 characters").max(40).optional(),
  availability: z.enum(DRIVER_AVAILABILITY.filter((a) => a !== "ON_ROUTE") as ["AVAILABLE", "OFF_DUTY"]).optional(),
  maxActiveJobs: z.coerce.number().int().min(1).max(10).optional(),
  active: z.boolean().optional(),
});

export const createVehicleSchema = z.object({
  registrationNumber: z.string().trim().toUpperCase().min(3, "Registration number is required").max(20),
  type: z.enum(VEHICLE_TYPES),
  capacity: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});

export const updateVehicleSchema = z.object({
  registrationNumber: z.string().trim().toUpperCase().min(3, "Registration number must be at least 3 characters").max(20).optional(),
  type: z.enum(VEHICLE_TYPES).optional(),
  capacity: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  status: z.enum(VEHICLE_STATUSES).optional(),
});

export function firstError(zodError: z.ZodError): string {
  return zodError.issues[0]?.message ?? "Invalid input";
}

// ── Company accounts, passwords, staff & settings ────────────

const personName = z.string().trim().min(2, "Name must be at least 2 characters").max(120, "Name must be 120 characters or fewer");
const accountEmail = z.string().trim().toLowerCase().email("Enter a valid email").max(254);
const newPassword = z.string().min(8, "Password must be at least 8 characters").max(200, "Password must be 200 characters or fewer");
const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`).optional().or(z.literal(""));

export const signupSchema = z.object({
  companyName: z.string().trim().min(2, "Company name must be at least 2 characters").max(120, "Company name must be 120 characters or fewer"),
  name: personName,
  email: accountEmail,
  password: newPassword,
  phone: z.string().trim().min(6, "Phone must be at least 6 characters").max(30, "Phone must be 30 characters or fewer").optional().or(z.literal("")),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(200),
    newPassword,
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "The new password must be different from the current one",
    path: ["newPassword"],
  });

/** Admin-initiated reset: omit `password` to have the server generate one. */
export const resetPasswordSchema = z.object({
  password: newPassword.optional(),
});

export const createStaffSchema = z.object({
  name: personName,
  email: accountEmail,
  password: newPassword.optional(),
});

export const updateStaffSchema = z.object({
  action: z.enum(["activate", "deactivate", "reset-password"]),
});

export const updateOrgSchema = z.object({
  name: z.string().trim().min(2, "Company name must be at least 2 characters").max(120, "Company name must be 120 characters or fewer").optional(),
  phone: z.string().trim().min(6, "Phone must be at least 6 characters").max(30, "Phone must be 30 characters or fewer").optional().or(z.literal("")),
  contactEmail: z.string().trim().toLowerCase().email("Enter a valid contact email").max(254).optional().or(z.literal("")),
  address: optionalText(300, "Address"),
  defaultPickupAddress: optionalText(300, "Default pickup address"),
  timezone: z
    .string()
    .trim()
    .min(1, "Select a timezone")
    .max(64)
    .refine((tz) => isValidTimezone(tz), "Select a valid timezone")
    .optional(),
});

export const onboardingSchema = z.object({
  dismissed: z.boolean(),
});
