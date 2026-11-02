import type { TrackingData } from "@/lib/tracking";
import { DICTIONARIES, INTL_LOCALE, type Lang, type TrackingDict } from "./i18n";

// ─────────────────────────────────────────────────────────────
// Pure helpers for the public tracking page (no React).
// All dates are shown in the SENDER's timezone (Organization.timezone),
// in the visitor's chosen language.
// ─────────────────────────────────────────────────────────────

export const STEP_STATUSES = ["CREATED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"] as const;

/** Statuses that will not change again — no live refresh needed. */
export function isFinalStatus(status: string): boolean {
  return status === "DELIVERED" || status === "CANCELLED";
}

/** Cash still to collect: COD set and the parcel not yet handed over (or cancelled). */
export function codDue(data: TrackingData): boolean {
  return !!data.codAmount && data.codAmount > 0 && !isFinalStatus(data.status);
}

/** COD that was collected at the door. */
export function codPaid(data: TrackingData): boolean {
  return !!data.codAmount && data.codAmount > 0 && data.status === "DELIVERED";
}

export type HeroTone = "active" | "delivered" | "failed" | "cancelled";

export function heroTone(status: string): HeroTone {
  if (status === "DELIVERED") return "delivered";
  if (status === "FAILED") return "failed";
  if (status === "CANCELLED") return "cancelled";
  return "active";
}

// ─────────────────────────────────────────────────────────────
// Locale + timezone formatting
// ─────────────────────────────────────────────────────────────

export const DEFAULT_TIMEZONE = "Asia/Dhaka";

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export interface TrackingFormat {
  lang: Lang;
  t: TrackingDict;
  timeZone: string;
  /** Plain number in the active locale (Bengali digits for bn). */
  number(n: number): string;
  /** Whole-taka amount: "৳1,250" / "৳১,২৫০". */
  money(n: number): string;
  /** Clock time: "3:12 pm" / "বিকাল ৩:১২". */
  time(d: Date): string;
  /** "28 Oct" / "28 Oct 2026". */
  dayMonth(d: Date, withYear: boolean): string;
  /** "Tue 28 Oct" / "Tue 28 Oct 2026". */
  weekdayDayMonth(d: Date, withYear: boolean): string;
  /** "28 Oct 2026". */
  fullDate(d: Date): string;
  /** "28 Oct 2026, 3:12 pm". */
  dateTime(d: Date): string;
  /** Calendar days from `now` to `d` in the sender's timezone (0 = same day, 1 = tomorrow). */
  dayDiff(d: Date, now: Date): number;
  sameYear(d: Date, now: Date): boolean;
  /** A deadline stored as midnight (no time chosen) in the sender's timezone. */
  isDateOnly(d: Date): boolean;
}

function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Bangla day-period words — reads far more naturally than "PM". */
function bnDayPeriod(hour: number): string {
  if (hour >= 4 && hour < 6) return "ভোর";
  if (hour >= 6 && hour < 12) return "সকাল";
  if (hour >= 12 && hour < 15) return "দুপুর";
  if (hour >= 15 && hour < 18) return "বিকাল";
  if (hour >= 18 && hour < 20) return "সন্ধ্যা";
  return "রাত";
}

export function createTrackingFormat(lang: Lang, timeZone?: string | null): TrackingFormat {
  const tz = safeTimeZone(timeZone);
  const locale = INTL_LOCALE[lang];
  const t = DICTIONARIES[lang];

  const partsFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const parts = (d: Date): ZonedParts => {
    const out: Record<string, number> = {};
    for (const p of partsFmt.formatToParts(d)) if (p.type !== "literal") out[p.type] = Number(p.value);
    return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
  };
  const dayIndex = (d: Date) => {
    const p = parts(d);
    return Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
  };

  const num = new Intl.NumberFormat(locale);
  const twoDigits = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
  const enTime = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
  const dm = new Intl.DateTimeFormat(locale, { timeZone: tz, day: "numeric", month: "short" });
  const dmy = new Intl.DateTimeFormat(locale, { timeZone: tz, day: "numeric", month: "short", year: "numeric" });
  const wdm = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
  const wdmy = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const time = (d: Date) => {
    if (lang !== "bn") return enTime.format(d);
    const { hour, minute } = parts(d);
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${bnDayPeriod(hour)} ${num.format(h12)}:${twoDigits.format(minute)}`;
  };

  return {
    lang,
    t,
    timeZone: tz,
    number: (n) => num.format(n),
    money: (n) => `৳${num.format(n)}`,
    time,
    dayMonth: (d, withYear) => (withYear ? dmy : dm).format(d),
    weekdayDayMonth: (d, withYear) => (withYear ? wdmy : wdm).format(d),
    fullDate: (d) => dmy.format(d),
    dateTime: (d) => `${dmy.format(d)}, ${time(d)}`,
    dayDiff: (d, now) => dayIndex(d) - dayIndex(now),
    sameYear: (d, now) => parts(d).year === parts(now).year,
    isDateOnly: (d) => {
      const p = parts(d);
      return p.hour === 0 && p.minute === 0 && p.second === 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Copy helpers
// ─────────────────────────────────────────────────────────────

/** The single status statement shown in the hero (also the step label). */
export function statusHeadline(status: string, f: TrackingFormat): string {
  return (f.t.statusHeadline as Record<string, string>)[status] ?? f.t.statusHeadlineDefault;
}

export function eventLabel(eventType: string, f: TrackingFormat): string {
  return f.t.eventLabels[eventType] ?? eventType;
}

/** Customer-facing failure reason; null for "Other"/unknown (a generic sentence is used instead). */
function failureReasonText(data: TrackingData, f: TrackingFormat): string | null {
  const code = data.failureReasonCode;
  if (!code || code === "OTHER") return null;
  return f.t.failureReasons[code] ?? (f.lang === "en" ? data.failureReason : null);
}

/** One human sentence explaining the current status. */
export function statusExplanation(data: TrackingData, f: TrackingFormat): string {
  const { t } = f;
  const sender = data.sender.name;
  switch (data.status) {
    case "CREATED":
      return t.explainCreated(sender);
    case "ASSIGNED":
      return t.explainAssigned;
    case "PICKED_UP":
      return t.explainPickedUp;
    case "IN_TRANSIT":
      return t.explainInTransit;
    case "DELIVERED":
      return t.explainDelivered;
    case "FAILED":
      return t.explainFailed(failureReasonText(data, f), sender);
    case "CANCELLED":
      return t.explainCancelled;
    default:
      return t.explainDefault;
  }
}

function dayPhrase(d: Date, now: Date, f: TrackingFormat): string {
  const diff = f.dayDiff(d, now);
  if (diff === 0) return f.t.today;
  if (diff === 1) return f.t.tomorrow;
  if (diff === -1) return f.t.yesterday;
  return f.weekdayDayMonth(d, !f.sameYear(d, now));
}

/** Last timestamp of a given event type in the (ascending) timeline. */
export function lastEventAt(data: TrackingData, eventType: string): string | null {
  for (let i = data.timeline.length - 1; i >= 0; i--) {
    if (data.timeline[i].eventType === eventType) return data.timeline[i].timestamp;
  }
  return null;
}

/**
 * The time line in the hero: "Expected today by 6:00 pm", "Expected Tue 28 Oct"
 * (date-only deadline) or "Delivered at 3:12 pm, 21 Oct". Null when nothing useful.
 */
export function etaLine(data: TrackingData, nowMs: number, f: TrackingFormat): string | null {
  const now = new Date(nowMs);
  if (data.status === "DELIVERED") {
    const at = data.completedAt ?? lastEventAt(data, "DELIVERED");
    if (!at) return null;
    const d = new Date(at);
    return f.t.deliveredAt(f.time(d), f.dayMonth(d, !f.sameYear(d, now)));
  }
  if (data.status === "CANCELLED" || data.status === "FAILED") return null;
  if (!data.expectedAt) return f.t.etaToBeConfirmed;
  const d = new Date(data.expectedAt);
  const day = dayPhrase(d, now, f);
  return f.isDateOnly(d) ? f.t.expectedDay(day) : f.t.expectedDayBy(day, f.time(d));
}

/** "Just now", "12 min ago" for the last hour; absolute ("Today, 3:12 pm", "Tue 21 Oct, 3:12 pm") otherwise. */
export function eventTime(iso: string, nowMs: number, f: TrackingFormat): string {
  const d = new Date(iso);
  const diffMin = Math.floor((nowMs - d.getTime()) / 60_000);
  if (diffMin >= 0 && diffMin < 1) return f.t.justNow;
  if (diffMin >= 1 && diffMin < 60) return f.t.minAgo(f.number(diffMin));
  const now = new Date(nowMs);
  const time = f.time(d);
  const days = f.dayDiff(d, now);
  if (days === 0) return f.t.todayAt(time);
  if (days === -1) return f.t.yesterdayAt(time);
  const date = f.sameYear(d, now) ? f.weekdayDayMonth(d, false) : f.dayMonth(d, true);
  return f.t.dateAt(date, time);
}

/** Stepper stamp — same wording as the updates list so both read alike ("Yesterday, 3:08 pm"). */
export function stepTime(iso: string, nowMs: number, f: TrackingFormat): string {
  return eventTime(iso, nowMs, f);
}

/** "Updated just now" / "Updated 3 min ago" / "Updated 2 hr ago". */
export function updatedAgo(updatedMs: number, nowMs: number, f: TrackingFormat): string {
  const diffMin = Math.floor((nowMs - updatedMs) / 60_000);
  if (diffMin < 1) return f.t.updatedJustNow;
  if (diffMin < 60) return f.t.updatedMinAgo(f.number(diffMin));
  return f.t.updatedHrAgo(f.number(Math.floor(diffMin / 60)));
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
  const steps: readonly string[] = STEP_STATUSES;

  let current: number;
  if (data.status === "DELIVERED") {
    current = steps.length - 1;
  } else {
    const found = steps.indexOf(data.status);
    if (found >= 0) {
      current = found;
    } else {
      // FAILED / CANCELLED → furthest step the timeline reached, else 0
      current = 0;
      for (const ev of data.timeline) {
        const idx = steps.indexOf(ev.eventType);
        if (idx >= 0) current = Math.max(current, idx);
      }
    }
  }

  return steps.map((status, i) => {
    let at = lastEventAt(data, status);
    if (!at && status === "CREATED") at = data.createdAt;
    if (!at && status === "DELIVERED" && data.status === "DELIVERED") at = data.completedAt;
    const reached = i <= current;
    const isCurrent = !cancelled && data.status !== "DELIVERED" && i === current;
    return {
      status,
      reached,
      current: isCurrent,
      neutral: cancelled && reached,
      failed: failed && isCurrent,
      at: reached ? at : null,
    };
  });
}
