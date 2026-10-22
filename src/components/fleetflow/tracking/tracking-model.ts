import { format, isSameDay, isSameYear, subDays, addDays } from "date-fns";
import { isDateOnly } from "@/lib/format";
import type { TrackingData } from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// Pure helpers for the public tracking page (no React).
// ─────────────────────────────────────────────────────────────

export const STEPS: { status: string; label: string }[] = [
  { status: "CREATED", label: "Order received" },
  { status: "ASSIGNED", label: "Courier assigned" },
  { status: "PICKED_UP", label: "Picked up" },
  { status: "IN_TRANSIT", label: "On the way" },
  { status: "DELIVERED", label: "Delivered" },
];

export const TRACK_EVENT_LABELS: Record<string, string> = {
  CREATED: "Order received",
  ASSIGNED: "Courier assigned",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "On the way",
  DELIVERED: "Delivered",
  FAILED: "Attempt unsuccessful",
  CANCELLED: "Cancelled",
  NOTE: "Update",
  TRACKING_UPDATED: "Update",
  OVERRIDE: "Status updated",
};

/** Statuses that will not change again — no live refresh needed. */
export function isFinalStatus(status: string): boolean {
  return status === "DELIVERED" || status === "CANCELLED";
}

export type HeroTone = "active" | "delivered" | "failed" | "cancelled";

export function heroTone(status: string): HeroTone {
  if (status === "DELIVERED") return "delivered";
  if (status === "FAILED") return "failed";
  if (status === "CANCELLED") return "cancelled";
  return "active";
}

/** The single status statement shown in the hero. */
export function statusHeadline(status: string): string {
  switch (status) {
    case "CREATED":
      return "Order received";
    case "ASSIGNED":
      return "Courier assigned";
    case "PICKED_UP":
      return "Picked up";
    case "IN_TRANSIT":
      return "On the way";
    case "DELIVERED":
      return "Delivered";
    case "FAILED":
      return "Attempt unsuccessful";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Tracking your delivery";
  }
}

/** One human sentence explaining the current status. */
export function statusExplanation(data: TrackingData): string {
  const sender = data.sender.name;
  switch (data.status) {
    case "CREATED":
      return `${sender} has received your order and is preparing it for delivery.`;
    case "ASSIGNED":
      return "A courier has been assigned and will collect your parcel soon.";
    case "PICKED_UP":
      return "Your parcel has been collected and will be on its way shortly.";
    case "IN_TRANSIT":
      return "Your parcel left the warehouse and is with the courier.";
    case "DELIVERED":
      return "Your parcel has been handed over. Thank you for your order.";
    case "FAILED":
      return `${data.failureReason ? `${data.failureReason}. ` : "We couldn’t complete the delivery. "}${sender} will contact you to arrange a new time.`;
    case "CANCELLED":
      return "This delivery has been cancelled and will not be delivered. Contact the sender if you have any questions.";
    default:
      return "We'll keep this page up to date as your delivery progresses.";
  }
}

function dayPhrase(d: Date, now: Date): string {
  if (isSameDay(d, now)) return "today";
  if (isSameDay(d, addDays(now, 1))) return "tomorrow";
  if (isSameDay(d, subDays(now, 1))) return "yesterday";
  return isSameYear(d, now) ? format(d, "EEE, d MMM") : format(d, "EEE, d MMM yyyy");
}

/** Last timestamp of a given event type in the (ascending) timeline. */
export function lastEventAt(data: TrackingData, eventType: string): string | null {
  for (let i = data.timeline.length - 1; i >= 0; i--) {
    if (data.timeline[i].eventType === eventType) return data.timeline[i].timestamp;
  }
  return null;
}

/**
 * The time line in the hero: "Expected today by 6:00 PM", "Expected Tue, 28 Oct"
 * (date-only deadline) or "Delivered at 3:12 PM, 21 Oct". Null when nothing useful.
 */
export function etaLine(data: TrackingData, nowMs: number): string | null {
  const now = new Date(nowMs);
  if (data.status === "DELIVERED") {
    const at = data.completedAt ?? lastEventAt(data, "DELIVERED");
    if (!at) return null;
    const d = new Date(at);
    return `Delivered at ${format(d, "h:mm a")}, ${format(d, isSameYear(d, now) ? "d MMM" : "d MMM yyyy")}`;
  }
  if (data.status === "CANCELLED" || data.status === "FAILED") return null;
  if (!data.expectedAt) return "Delivery time to be confirmed";
  const d = new Date(data.expectedAt);
  const day = dayPhrase(d, now);
  return isDateOnly(d) ? `Expected ${day}` : `Expected ${day} by ${format(d, "h:mm a")}`;
}

/** "Just now", "12 min ago" for the last hour; absolute ("Today, 3:12 PM", "Tue, 21 Oct, 3:12 PM") otherwise. */
export function eventTime(iso: string, nowMs: number): string {
  const d = new Date(iso);
  const diffMin = Math.floor((nowMs - d.getTime()) / 60_000);
  if (diffMin >= 0 && diffMin < 1) return "Just now";
  if (diffMin >= 1 && diffMin < 60) return `${diffMin} min ago`;
  const now = new Date(nowMs);
  const time = format(d, "h:mm a");
  if (isSameDay(d, now)) return `Today, ${time}`;
  if (isSameDay(d, subDays(now, 1))) return `Yesterday, ${time}`;
  return `${format(d, isSameYear(d, now) ? "EEE, d MMM" : "d MMM yyyy")}, ${time}`;
}

/** Stepper stamp — same wording as the updates list so both read alike ("Yesterday, 3:08 PM"). */
export function stepTime(iso: string, nowMs: number): string {
  return eventTime(iso, nowMs);
}

/** "Updated just now" / "Updated 3 min ago" / "Updated 2 hr ago". */
export function updatedAgo(updatedMs: number, nowMs: number): string {
  const diffMin = Math.floor((nowMs - updatedMs) / 60_000);
  if (diffMin < 1) return "Updated just now";
  if (diffMin < 60) return `Updated ${diffMin} min ago`;
  return `Updated ${Math.floor(diffMin / 60)} hr ago`;
}

/** Initials for the sender monogram (max two letters). */
export function monogram(name: string): string {
  // Skip words like "&" or "-" so "Rahim & Sons" → "RS".
  const parts = name.trim().split(/\s+/).filter((p) => /^[\p{L}\p{N}]/u.test(p));
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
  return letters.toUpperCase();
}

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Strip a display phone number down to something a tel: link dials reliably. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export type StepState = {
  status: string;
  label: string;
  reached: boolean;
  current: boolean;
  /** Reached but the delivery is cancelled — shown neutral. */
  neutral: boolean;
  /** The step where a failed attempt happened. */
  failed: boolean;
  at: string | null;
};

/** Where the delivery sits on the 5-step journey, plus per-step timestamps. */
export function computeSteps(data: TrackingData): StepState[] {
  const cancelled = data.status === "CANCELLED";
  const failed = data.status === "FAILED";

  let current: number;
  if (data.status === "DELIVERED") {
    current = STEPS.length - 1;
  } else {
    const found = STEPS.findIndex((s) => s.status === data.status);
    if (found >= 0) {
      current = found;
    } else {
      // FAILED / CANCELLED → furthest step the timeline reached, else 0
      current = 0;
      for (const ev of data.timeline) {
        const idx = STEPS.findIndex((s) => s.status === ev.eventType);
        if (idx >= 0) current = Math.max(current, idx);
      }
    }
  }

  return STEPS.map((step, i) => {
    let at = lastEventAt(data, step.status);
    if (!at && step.status === "CREATED") at = data.createdAt;
    if (!at && step.status === "DELIVERED" && data.status === "DELIVERED") at = data.completedAt;
    const reached = i <= current;
    const isCurrent = !cancelled && data.status !== "DELIVERED" && i === current;
    return {
      status: step.status,
      label: step.label,
      reached,
      current: isCurrent,
      neutral: cancelled && reached,
      failed: failed && isCurrent,
      at: reached ? at : null,
    };
  });
}
