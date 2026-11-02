import { z } from "zod";
import { isValidTimezone } from "@/lib/timezone";
import { DELIVERY_STATUSES, PRIORITIES, DRIVER_AVAILABILITY, VEHICLE_TYPES, VEHICLE_STATUSES, FAILURE_REASONS } from "@/lib/constants";
import { cleanAreas, ZONE_LIMITS } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────
// Zod request schemas — validate every write at the boundary
// ─────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email").max(254),
  password: z.string().min(1, "Password is required").max(200),
});

/** Whole taka, as typed or sent (numbers or numeric strings). */
export const codAmount = z.coerce
  .number("Enter the cash amount in taka")
  .int("Enter whole taka (no poisha)")
  .min(0, "The cash amount can't be negative")
  .max(10_000_000, "The cash amount is too large");

/** Parcel weight in kg (decimals allowed). Prices extra kilograms (src/lib/zones.ts). */
export const weightKg = z.coerce
  .number("Enter the weight in kg")
  .positive("Weight must be more than 0 kg")
  .max(ZONE_LIMITS.kgMax, `Weight must be at most ${ZONE_LIMITS.kgMax} kg`);

/** A delivery charge typed by staff, whole BDT. */
export const deliveryFeeBdt = z.coerce
  .number("Enter the delivery charge in taka")
  .int("Enter the delivery charge in whole taka")
  .min(0, "The delivery charge can't be negative")
  .max(ZONE_LIMITS.feeMax, "The delivery charge is too large");

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
  /** Cash to collect on delivery, whole BDT; null/0 = prepaid. */
  codAmount: codAmount.nullable().optional(),
  /** Parcel weight in kg; null = not weighed (no extra-kg charge). */
  weightKg: weightKg.nullable().optional(),
});

/**
 * Staff-only charge fields (the app, not the public API): a manually chosen
 * zone (null = match automatically) and a typed fee (null = calculate).
 */
const deliveryChargeFields = {
  zoneId: z.string().trim().min(1, "Choose a delivery zone").max(64).nullable().optional(),
  deliveryFeeBdt: deliveryFeeBdt.nullable().optional(),
};

/**
 * Staff-only map pin (geoSource PIN). parseDeliveryPoint (src/lib/geocoding.ts)
 * checks the pair is inside Bangladesh; null on edit removes the pin.
 */
const deliveryPinFields = {
  deliveryLat: z.number("Latitude must be a number").min(-90).max(90).nullable().optional(),
  deliveryLng: z.number("Longitude must be a number").min(-180).max(180).nullable().optional(),
};

/** POST /api/deliveries (staff). */
export const createStaffDeliverySchema = createDeliverySchema.extend({ ...deliveryChargeFields, ...deliveryPinFields });

// Explicit .optional() on priority: zod 4 still applies .default() inside .partial(),
// which would silently reset priority to NORMAL on every edit.
export const updateDeliverySchema = createDeliverySchema.extend({ priority: z.enum(PRIORITIES).optional(), ...deliveryChargeFields, ...deliveryPinFields }).partial();

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
  /** Cash the driver actually collected — required when completing a COD delivery. */
  codCollectedAmount: codAmount.optional(),
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

/** "Forgot password?" request (the answer is the same whether or not the account exists). */
export const forgotPasswordSchema = z.object({ email: accountEmail });

/** New password from an emailed reset link — the same rules as changePasswordSchema. */
export const resetPasswordWithTokenSchema = z.object({
  token: z.string("This reset link is incomplete").trim().min(20, "This reset link is incomplete").max(200, "This reset link is invalid"),
  newPassword,
});

/** Admin-initiated reset: omit `password` to have the server generate one. */
export const resetPasswordSchema = z.object({
  password: newPassword.optional(),
});

const staffRole = z.enum(["ADMIN", "DISPATCHER"], "Choose Admin or Dispatcher");

export const createStaffSchema = z.object({
  name: personName,
  email: accountEmail,
  password: newPassword.optional(),
  role: staffRole.default("DISPATCHER"),
});

export const updateStaffSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["activate", "deactivate", "reset-password"]) }),
  z.object({ action: z.literal("set-role"), role: staffRole }),
]);

export const updateOrgSchema = z.object({
  name: z.string().trim().min(2, "Company name must be at least 2 characters").max(120, "Company name must be 120 characters or fewer").optional(),
  phone: z.string().trim().min(6, "Phone must be at least 6 characters").max(30, "Phone must be 30 characters or fewer").optional().or(z.literal("")),
  contactEmail: z.string().trim().toLowerCase().email("Enter a valid contact email").max(254).optional().or(z.literal("")),
  address: optionalText(300, "Address"),
  defaultPickupAddress: optionalText(300, "Default pickup address"),
  /** Depot / pickup point on the map (both or neither; null removes it). */
  pickupLat: z.number("Latitude must be a number").min(-90).max(90).nullable().optional(),
  pickupLng: z.number("Longitude must be a number").min(-180).max(180).nullable().optional(),
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

// ── Delivery zones & charges (src/lib/zones.ts) ──────────────

const takaField = (label: string) =>
  z.coerce
    .number(`Enter the ${label} in taka`)
    .int(`Enter the ${label} in whole taka`)
    .min(0, `The ${label} can't be negative`)
    .max(ZONE_LIMITS.feeMax, `The ${label} is too large`);

// No .default()s here: zod 4 applies them inside .partial() too (see updateDeliverySchema).
const zoneFields = {
  name: z.string().trim().min(2, "Zone name must be at least 2 characters").max(ZONE_LIMITS.nameMax, `Zone name must be ${ZONE_LIMITS.nameMax} characters or fewer`),
  areas: z
    .array(
      z.string().trim().min(ZONE_LIMITS.areaMin, `Each area must be at least ${ZONE_LIMITS.areaMin} characters`).max(ZONE_LIMITS.areaMax, `Each area must be ${ZONE_LIMITS.areaMax} characters or fewer`),
      "Areas must be a list of keywords"
    )
    .max(ZONE_LIMITS.areasMax, `A zone can have at most ${ZONE_LIMITS.areasMax} areas`)
    .transform((a) => cleanAreas(a)),
  baseFeeBdt: takaField("base charge"),
  includedKg: z.coerce.number("Enter the included weight in kg").min(0, "Included weight can't be negative").max(ZONE_LIMITS.kgMax, `Included weight must be at most ${ZONE_LIMITS.kgMax} kg`),
  perExtraKgBdt: takaField("charge per extra kg"),
  codFeePercent: z.coerce.number("Enter the COD fee as a percentage").min(0, "The COD fee can't be negative").max(100, "The COD fee can be at most 100%"),
  codFeeMinBdt: takaField("minimum COD fee"),
  isDefault: z.boolean(),
  active: z.boolean(),
};

export const createZoneSchema = z.object({
  ...zoneFields,
  areas: zoneFields.areas.default([]),
  includedKg: zoneFields.includedKg.default(1),
  perExtraKgBdt: zoneFields.perExtraKgBdt.default(0),
  codFeePercent: zoneFields.codFeePercent.default(0),
  codFeeMinBdt: zoneFields.codFeeMinBdt.default(0),
  isDefault: zoneFields.isDefault.default(false),
  active: zoneFields.active.default(true),
});

export const updateZoneSchema = z.object(zoneFields).partial();

/** Full new order of the organization's zones (first = tried first). */
export const reorderZonesSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1, "Send the zone ids in their new order").max(ZONE_LIMITS.zonesMax),
});

/** POST /api/zones/preview — what the delivery form shows while typing. */
export const zonePreviewSchema = z.object({
  address: z.string().trim().max(300, "Address must be at most 300 characters").default(""),
  weightKg: weightKg.nullable().optional(),
  codAmount: codAmount.nullable().optional(),
  zoneId: z.string().trim().min(1).max(64).nullable().optional(),
});

/** POST /api/zones/recalculate — one bounded batch; pass nextCursor back for the next one. */
export const recalculateFeesSchema = z.object({
  cursor: z.string().min(1).max(64).nullable().optional(),
});
