import { db } from "@/lib/db";
import { failureReasonLabel } from "@/lib/constants";
import type { TrackingData as BaseTrackingData } from "@/lib/types";
import { resolveTrackingBranding, type TrackingBranding } from "@/lib/branding";
import { ratingBlock, ratingClosesAt, rescheduleBlock, rescheduleDateRange, type RescheduleBlock } from "@/lib/customer-feedback";

// ─────────────────────────────────────────────────────────────
// Public customer tracking — the ONE place that decides what a
// tracking-link holder may see. Used by GET /api/track/[token]
// (client polling) and the server-rendered /track/[token] page,
// so both always return exactly the same data.
//
// Exposes only customer-safe data: status, timestamps, the sender's
// public business details and customer-visible timeline entries.
// NEVER driver identity, vehicle details, internal notes, actor
// names or business-internal records.
// ─────────────────────────────────────────────────────────────

export interface TrackingData extends BaseTrackingData {
  /** Failure reason code (e.g. RECIPIENT_UNAVAILABLE) so the page can translate it; set only when FAILED. */
  failureReasonCode: string | null;
  /** Cash to collect on delivery, whole BDT. Null/0 = prepaid. */
  codAmount: number | null;
  /** The sender organization's IANA timezone — every date on the page is shown in it. */
  timezone: string;
  /** Logo / accent / message — null = default FleetFlow styling (no branded_tracking, or nothing set). */
  branding: TrackingBranding | null;
  /** What the customer can do on the page (src/lib/customer-feedback.ts). */
  feedback: TrackingFeedback;
}

export interface TrackingFeedback {
  rating: {
    /** Show the rating card (delivered, allowed, within the window, not yet rated). */
    canRate: boolean;
    /** The customer's own stars once given (never the comment). */
    score: number | null;
    /** Last moment the delivery can be rated (ISO), while canRate. */
    closesAt: string | null;
  };
  reschedule: {
    canRequest: boolean;
    /** Why not, when it matters to the customer ("limit" → call the sender). Null otherwise. */
    blockedBy: Extract<RescheduleBlock, "limit"> | null;
    status: "PENDING" | "ACCEPTED" | "DECLINED" | null;
    /** Start of the requested day / window (ISO). */
    requestedFor: string | null;
    window: string | null;
    /** Selectable days, "YYYY-MM-DD" in the sender's timezone. */
    minDate: string;
    maxDate: string;
  };
}

export type TrackingLookup =
  | { kind: "ok"; data: TrackingData }
  /** Malformed token or no delivery with this token. */
  | { kind: "not_found" }
  | { kind: "revoked" };

const TOKEN_RE = /^[a-f0-9]{16,64}$/i;

/** Token format sanity check to avoid odd lookups. */
export function isValidTrackingToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** The exact Prisma include the serializer needs — nothing more is loaded. */
const TRACKING_INCLUDE = {
  events: { where: { customerVisible: true }, orderBy: { createdAt: "asc" } },
  // Public business details only — the customer knows the sender, not FleetFlow.
  // Branding + feedback switches are read here; the plan's features decide
  // whether the branding is applied (re-checked on every render).
  organization: {
    select: {
      id: true,
      name: true,
      phone: true,
      timezone: true,
      brandColor: true,
      brandLogoKey: true,
      trackingMessage: true,
      allowCustomerRating: true,
      allowCustomerReschedule: true,
      planRecord: { select: { features: true } },
    },
  },
  _count: { select: { events: { where: { eventType: "RESCHEDULE_REQUESTED" } } } },
} as const;

/** Timeline entries whose note was written FOR the customer and may be shown. */
const CUSTOMER_NOTE_EVENTS = new Set(["NOTE", "RESCHEDULE_REQUESTED", "RESCHEDULE_ACCEPTED", "RESCHEDULE_DECLINED"]);

/** Minimal shape the serializer reads (a Prisma delivery with TRACKING_INCLUDE satisfies it). */
export interface TrackingSource {
  trackingCode: string;
  status: string;
  recipientName: string;
  deliveryAddress: string;
  expectedAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
  codAmount: number | null;
  organization: {
    name: string;
    phone: string | null;
    timezone: string | null;
    id?: string;
    brandColor?: string | null;
    brandLogoKey?: string | null;
    trackingMessage?: string | null;
    allowCustomerRating?: boolean;
    allowCustomerReschedule?: boolean;
    planRecord?: { features: string[] } | null;
  };
  events: { eventType: string; note: string | null; createdAt: Date }[];
  rating?: number | null;
  rescheduleStatus?: string | null;
  rescheduleRequestedFor?: Date | null;
  rescheduleWindow?: string | null;
  /** Reschedule requests made so far (RESCHEDULE_REQUESTED events, all of them). */
  _count?: { events: number };
}

function serializeFeedback(delivery: TrackingSource, timezone: string, now: Date): TrackingFeedback {
  const org = delivery.organization;
  const rating = delivery.rating ?? null;
  const canRate =
    ratingBlock(
      { status: delivery.status, completedAt: delivery.completedAt, rating, allowCustomerRating: org.allowCustomerRating ?? true },
      now
    ) === null;
  const block = rescheduleBlock({
    status: delivery.status,
    rescheduleStatus: delivery.rescheduleStatus ?? null,
    allowCustomerReschedule: org.allowCustomerReschedule ?? true,
    requestCount: delivery._count?.events ?? 0,
  });
  const status = delivery.rescheduleStatus;
  const range = rescheduleDateRange(now, timezone);
  return {
    rating: {
      canRate,
      score: delivery.status === "DELIVERED" ? rating : null,
      closesAt: canRate ? (ratingClosesAt(delivery.completedAt)?.toISOString() ?? null) : null,
    },
    reschedule: {
      canRequest: block === null,
      blockedBy: block === "limit" ? "limit" : null,
      status: status === "PENDING" || status === "ACCEPTED" || status === "DECLINED" ? status : null,
      requestedFor: delivery.rescheduleRequestedFor?.toISOString() ?? null,
      window: delivery.rescheduleWindow ?? null,
      minDate: range.min,
      maxDate: range.max,
    },
  };
}

const DEFAULT_TIMEZONE = "Asia/Dhaka";

/** Build the customer-safe payload. Pure — explicitly picks every field, so new DB columns never leak. */
export function serializeTracking(delivery: TrackingSource, now: Date = new Date()): TrackingData {
  const failed = delivery.status === "FAILED";
  const timezone = delivery.organization.timezone || DEFAULT_TIMEZONE;
  return {
    trackingCode: delivery.trackingCode,
    status: delivery.status,
    recipientName: delivery.recipientName,
    deliveryAddress: delivery.deliveryAddress,
    expectedAt: delivery.expectedAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    failureReason: failed ? failureReasonLabel(delivery.failureReason) : null,
    failureReasonCode: failed ? (delivery.failureReason ?? null) : null,
    completedAt: delivery.status === "DELIVERED" ? (delivery.completedAt?.toISOString() ?? null) : null,
    codAmount: typeof delivery.codAmount === "number" && delivery.codAmount > 0 ? delivery.codAmount : null,
    timezone,
    sender: { name: delivery.organization.name, phone: delivery.organization.phone },
    timeline: delivery.events.map((e) => ({
      eventType: e.eventType,
      // Only pass through notes written intentionally for the customer
      // (NOTE, and the reschedule request / staff reply).
      // Internal notes (driver names, vehicle regs, ops details) never leak.
      note: CUSTOMER_NOTE_EVENTS.has(e.eventType) ? e.note : null,
      timestamp: e.createdAt.toISOString(),
    })),
    branding: resolveTrackingBranding(delivery.organization, delivery.organization.planRecord?.features),
    feedback: serializeFeedback(delivery, timezone, now),
  };
}

/** Look up a tracking link. Throws only on unexpected (DB) errors. */
export async function loadTracking(token: string): Promise<TrackingLookup> {
  if (!isValidTrackingToken(token)) return { kind: "not_found" };
  const delivery = await db.delivery.findUnique({ where: { trackingToken: token }, include: TRACKING_INCLUDE });
  if (!delivery) return { kind: "not_found" };
  if (!delivery.trackingEnabled) return { kind: "revoked" };
  return { kind: "ok", data: serializeTracking(delivery) };
}
