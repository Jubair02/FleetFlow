import { z } from "zod";
import { TRACKING_MESSAGE_MAX, normalizeHexColor } from "@/lib/branding";
import { toZoned, wallTimeToInstant } from "@/lib/zoned";

// ─────────────────────────────────────────────────────────────
// Customer feedback from the public tracking page — client-safe, pure.
//
//   Rating       once per delivery, 1–5 stars + optional comment, from
//                delivery until RATING_WINDOW_DAYS after completedAt, when
//                the company allows it (Organization.allowCustomerRating).
//   Reschedule   while the delivery is CREATED, ASSIGNED or FAILED and the
//                company allows it: a day from tomorrow to +14 days (in the
//                COMPANY's timezone), a time window and a note. One request
//                can be pending at a time, at most RESCHEDULE_MAX_REQUESTS
//                per delivery. Staff accept (sets expectedAt; a FAILED
//                delivery goes back to the pending queue) or decline.
//
// Server side: src/lib/customer-feedback-service.ts. Docs: docs/CUSTOMER-EXPERIENCE.md.
// ─────────────────────────────────────────────────────────────

export const RATING_WINDOW_DAYS = 14;
export const RATING_COMMENT_MAX = 500;
export const RESCHEDULE_NOTE_MAX = 300;
export const RESCHEDULE_MAX_DAYS_AHEAD = 14;
export const RESCHEDULE_MAX_REQUESTS = 3;
export const RESCHEDULE_STATUSES = ["PENDING", "ACCEPTED", "DECLINED"] as const;
export type RescheduleStatus = (typeof RESCHEDULE_STATUSES)[number];

/** Delivery statuses a customer may ask to move. */
export const RESCHEDULABLE_STATUSES = ["CREATED", "ASSIGNED", "FAILED"] as const;
/** Statuses staff can still accept a request in (FAILED is reopened as CREATED). */
export const ACCEPTABLE_STATUSES = RESCHEDULABLE_STATUSES;

export const RESCHEDULE_WINDOWS = ["ANY", "MORNING", "AFTERNOON", "EVENING"] as const;
export type RescheduleWindow = (typeof RESCHEDULE_WINDOWS)[number];

/**
 * Local hours of each window, [start, end). ANY = the whole day: its request
 * and deadline are stored as local midnight (a date-only deadline).
 */
export const WINDOW_HOURS: Record<RescheduleWindow, [number, number] | null> = {
  ANY: null,
  MORNING: [9, 12],
  AFTERNOON: [12, 17],
  EVENING: [17, 21],
};

/** Staff-facing labels (the tracking page has its own en/bn copy). */
export const WINDOW_LABELS: Record<RescheduleWindow, string> = {
  ANY: "Any time",
  MORNING: "Morning (9 am – 12 pm)",
  AFTERNOON: "Afternoon (12 – 5 pm)",
  EVENING: "Evening (5 – 9 pm)",
};

export function isRescheduleWindow(v: unknown): v is RescheduleWindow {
  return typeof v === "string" && (RESCHEDULE_WINDOWS as readonly string[]).includes(v);
}

const DAY_MS = 86_400_000;

// ── dates in the company timezone ────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of an instant in `tz`. */
export function dayKeyInTz(instant: Date, tz: string): string {
  const z = toZoned(instant, tz);
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`;
}

/** Calendar arithmetic on a "YYYY-MM-DD" key. */
export function addDaysToKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days a customer can pick: tomorrow … +RESCHEDULE_MAX_DAYS_AHEAD, in the company's timezone. */
export function rescheduleDateRange(now: Date, tz: string): { min: string; max: string } {
  const today = dayKeyInTz(now, tz);
  return { min: addDaysToKey(today, 1), max: addDaysToKey(today, RESCHEDULE_MAX_DAYS_AHEAD) };
}

/** Every selectable day, in order. */
export function rescheduleDays(now: Date, tz: string): string[] {
  const { min } = rescheduleDateRange(now, tz);
  return Array.from({ length: RESCHEDULE_MAX_DAYS_AHEAD }, (_, i) => addDaysToKey(min, i));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Start of the requested day + window in `tz` (local midnight for ANY). Null for a malformed date. */
export function windowStart(date: string, window: RescheduleWindow, tz: string): Date | null {
  if (!DATE_RE.test(date)) return null;
  const hours = WINDOW_HOURS[window];
  return wallTimeToInstant(hours ? `${date}T${pad(hours[0])}:00` : date, tz);
}

/**
 * Default delivery deadline when staff accept: the END of the window
 * (expectedAt is a deadline — "expected by" and the on-time rate compare
 * completedAt ≤ expectedAt), or local midnight of the day for ANY, which the
 * app reads as a date-only deadline lasting the whole day.
 */
export function windowDeadline(date: string, window: RescheduleWindow, tz: string): Date | null {
  if (!DATE_RE.test(date)) return null;
  const hours = WINDOW_HOURS[window];
  return wallTimeToInstant(hours ? `${date}T${pad(hours[1])}:00` : date, tz);
}

/** English description for staff, notes and emails: "Mon 2 Nov 2026, morning (9 am – 12 pm)". */
export function describeReschedule(requestedFor: Date | string, window: string | null | undefined, tz: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(requestedFor)
  );
  if (!isRescheduleWindow(window) || window === "ANY") return `${day}, any time`;
  return `${day}, ${WINDOW_LABELS[window].replace(/^\w/, (c) => c.toLowerCase())}`;
}

export type RescheduleDateCheck = { ok: true; requestedFor: Date } | { ok: false; code: "invalid_date" };

/** Validate a requested day against the allowed range and resolve it to an instant. */
export function checkRescheduleDate(date: string, window: RescheduleWindow, tz: string, now: Date): RescheduleDateCheck {
  const { min, max } = rescheduleDateRange(now, tz);
  if (!DATE_RE.test(date) || date < min || date > max) return { ok: false, code: "invalid_date" };
  const requestedFor = windowStart(date, window, tz);
  return requestedFor ? { ok: true, requestedFor } : { ok: false, code: "invalid_date" };
}

// ── eligibility ──────────────────────────────────────────────

export type RatingBlock = "disabled" | "not_delivered" | "already_rated" | "expired";

export interface RatingSubject {
  status: string;
  completedAt: Date | null;
  rating: number | null;
  allowCustomerRating: boolean;
}

/** Last moment a delivery can be rated, or null when it isn't delivered. */
export function ratingClosesAt(completedAt: Date | null): Date | null {
  return completedAt ? new Date(completedAt.getTime() + RATING_WINDOW_DAYS * DAY_MS) : null;
}

/** Why a delivery can't be rated now, or null when it can. */
export function ratingBlock(d: RatingSubject, now: Date): RatingBlock | null {
  if (!d.allowCustomerRating) return "disabled";
  if (d.status !== "DELIVERED" || !d.completedAt) return "not_delivered";
  if (d.rating !== null && d.rating !== undefined) return "already_rated";
  const closes = ratingClosesAt(d.completedAt)!;
  if (now.getTime() > closes.getTime()) return "expired";
  return null;
}

export type RescheduleBlock = "disabled" | "not_eligible" | "pending" | "limit";

export interface RescheduleSubject {
  status: string;
  rescheduleStatus: string | null;
  allowCustomerReschedule: boolean;
  /** Requests already made for this delivery (RESCHEDULE_REQUESTED events). */
  requestCount: number;
}

/** Why the customer can't ask to reschedule now, or null when they can. */
export function rescheduleBlock(d: RescheduleSubject): RescheduleBlock | null {
  if (!d.allowCustomerReschedule) return "disabled";
  if (!(RESCHEDULABLE_STATUSES as readonly string[]).includes(d.status)) return "not_eligible";
  if (d.rescheduleStatus === "PENDING") return "pending";
  if (d.requestCount >= RESCHEDULE_MAX_REQUESTS) return "limit";
  return null;
}

// ── request schemas (public + staff) ─────────────────────────

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const ratingSchema = z.object({
  rating: z.coerce.number("Choose a rating").int("Choose a rating from 1 to 5").min(1, "Choose a rating from 1 to 5").max(5, "Choose a rating from 1 to 5"),
  comment: optionalText(RATING_COMMENT_MAX, `Keep the comment under ${RATING_COMMENT_MAX} characters`),
});
export type RatingInput = z.infer<typeof ratingSchema>;

export const rescheduleRequestSchema = z.object({
  date: z.string().regex(DATE_RE, "Choose a day"),
  window: z.enum(RESCHEDULE_WINDOWS, "Choose a time window").default("ANY"),
  note: optionalText(RESCHEDULE_NOTE_MAX, `Keep the note under ${RESCHEDULE_NOTE_MAX} characters`),
});
export type RescheduleRequestInput = z.infer<typeof rescheduleRequestSchema>;

export const rescheduleResolveSchema = z.object({
  action: z.enum(["accept", "decline"], "Choose accept or decline"),
  /** ISO instant; accept only. Default: the requested day's window end. */
  expectedAt: z.string().datetime({ offset: true, message: "Enter a valid date and time" }).optional().nullable(),
  /** Message shown to the customer on the tracking page (and in the email). */
  note: optionalText(RESCHEDULE_NOTE_MAX, `Keep the message under ${RESCHEDULE_NOTE_MAX} characters`),
});
export type RescheduleResolveInput = z.infer<typeof rescheduleResolveSchema>;

/** PATCH /api/settings/tracking — every field optional; "" / null clears colour and message. */
export const trackingSettingsSchema = z
  .object({
    brandColor: z
      .string()
      .trim()
      .nullable()
      .optional()
      .refine((v) => !v || normalizeHexColor(v) !== null, "Enter a colour like #0F766E")
      .transform((v) => (v ? normalizeHexColor(v) : v === undefined ? undefined : null)),
    trackingMessage: z
      .string()
      .trim()
      .max(TRACKING_MESSAGE_MAX, `Keep the message under ${TRACKING_MESSAGE_MAX} characters`)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
    allowCustomerRating: z.boolean().optional(),
    allowCustomerReschedule: z.boolean().optional(),
  })
  .strict();
export type TrackingSettingsInput = z.infer<typeof trackingSettingsSchema>;

/** "★★★★☆" for staff notes and emails. */
export function stars(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}
