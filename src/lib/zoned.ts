import { tzOffsetMinutes, zonedTimeToUtc } from "@/lib/timezone";

// ─────────────────────────────────────────────────────────────
// Company-timezone display helpers (client and server safe, no deps).
// The app shows every time in the COMPANY's timezone, not the viewer's
// browser timezone, so the office, drivers and CSV imports agree on
// what "today" and "5 PM" mean.
// ─────────────────────────────────────────────────────────────

/**
 * A Date whose browser-local fields (getHours(), date-fns format…) show the
 * wall-clock time of `instant` in `tz`. Only for formatting and calendar
 * comparisons — never send it to the server.
 */
export function toZoned(instant: Date, tz: string): Date {
  const wall = new Date(instant.getTime() + tzOffsetMinutes(instant, tz) * 60_000);
  return new Date(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    wall.getUTCMilliseconds()
  );
}

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" read as a wall-clock time in `tz` → the instant, or null. */
export function wallTimeToInstant(value: string, tz: string): Date | null {
  const m = WALL_TIME.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const instant = zonedTimeToUtc(y, mo, d, h, mi, tz);
  // Reject dates that rolled over (e.g. 31 Feb).
  const back = toZoned(instant, tz);
  return back.getDate() === d && back.getMonth() === mo - 1 ? instant : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Instant → "YYYY-MM-DDTHH:mm" in `tz` (value for <input type="datetime-local">). */
export function instantToWallInput(instant: Date, tz: string): string {
  const z = toZoned(instant, tz);
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}T${pad(z.getHours())}:${pad(z.getMinutes())}`;
}

/** The `tz` query parameter the dashboard/reports APIs expect (same sign as Date#getTimezoneOffset). */
export function tzQueryOffset(tz: string, at = new Date()): number {
  return -tzOffsetMinutes(at, tz);
}
