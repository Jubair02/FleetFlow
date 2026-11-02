// ─────────────────────────────────────────────────────────────
// Timezone helpers (no dependencies — uses Intl). Organizations
// store an IANA timezone (default Asia/Dhaka); CSV dates and plan
// "this month" windows are interpreted in that zone.
// ─────────────────────────────────────────────────────────────

export const DEFAULT_TIMEZONE = "Asia/Dhaka";

/** Common zones for FleetFlow customers (company settings and the platform console). */
export const TIMEZONES = [
  { value: "Asia/Dhaka", label: "Bangladesh — Asia/Dhaka (UTC+6)" },
  { value: "Asia/Kolkata", label: "India — Asia/Kolkata (UTC+5:30)" },
  { value: "Asia/Kathmandu", label: "Nepal — Asia/Kathmandu (UTC+5:45)" },
  { value: "Asia/Karachi", label: "Pakistan — Asia/Karachi (UTC+5)" },
  { value: "Asia/Dubai", label: "UAE — Asia/Dubai (UTC+4)" },
  { value: "Asia/Singapore", label: "Singapore — Asia/Singapore (UTC+8)" },
  { value: "Asia/Kuala_Lumpur", label: "Malaysia — Asia/Kuala_Lumpur (UTC+8)" },
  { value: "Europe/London", label: "UK — Europe/London" },
  { value: "UTC", label: "UTC" },
];

/** The list above, plus the organization's current zone when it isn't in it. */
export function timezoneOptions(current: string): { value: string; label: string }[] {
  return TIMEZONES.some((t) => t.value === current) ? TIMEZONES : [{ value: current, label: current }, ...TIMEZONES];
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` from UTC at `instant`, in minutes (Asia/Dhaka → +360). */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of a wall-clock time in `tz` (handles DST by re-checking the offset). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let offset = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - offset * 60_000;
  const corrected = tzOffsetMinutes(new Date(utc), tz);
  if (corrected !== offset) {
    offset = corrected;
    utc = guess - offset * 60_000;
  }
  return new Date(utc);
}

/** Start of the calendar month containing `now`, in `tz`. */
export function startOfMonthInTz(now: Date, tz: string): Date {
  const local = new Date(now.getTime() + tzOffsetMinutes(now, tz) * 60_000);
  return zonedTimeToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, 1, 0, 0, tz);
}

/** Midnight (start of today) in the given timezone, as a UTC instant. */
export function startOfDayInTz(now: Date, tz: string): Date {
  const local = new Date(now.getTime() + tzOffsetMinutes(now, tz) * 60_000);
  return zonedTimeToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), 0, 0, tz);
}
