"use client";

import { differenceInCalendarDays, format, formatDistanceToNow } from "date-fns";
import { toZoned } from "@/lib/zoned";
import { useAppStore } from "@/store/app-store";

/**
 * Timezone every date is shown in: the signed-in company's (Settings → Company),
 * falling back to the browser's outside a company session (e.g. super admins).
 */
export function displayTimezone(): string {
  return useAppStore.getState().session?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** `iso` as a Date whose local fields show the company's wall-clock time (formatting only). */
function zoned(iso: string | Date): Date {
  return toZoned(new Date(iso), displayTimezone());
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(zoned(iso), "d MMM yyyy, h:mm a");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(zoned(iso), "d MMM yyyy");
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(zoned(iso), "h:mm a");
}

/** date-fns `format` in the company's timezone, for one-off patterns. */
export function formatZoned(iso: string | Date, pattern: string): string {
  return format(zoned(iso), pattern);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

/**
 * A deadline at exactly midnight company time was given as a date only —
 * don't show "12:00 AM". CSV import stores date-only deadlines that way.
 */
export function isDateOnly(d: Date): boolean {
  const z = zoned(d);
  return z.getHours() === 0 && z.getMinutes() === 0 && z.getSeconds() === 0;
}

/**
 * When a deadline actually passes. A date-only deadline (stored as midnight
 * company time) lasts the whole day, so it's only overdue from the next midnight.
 */
export function deadlineMs(iso: string): number {
  const d = new Date(iso);
  return isDateOnly(d) ? d.getTime() + 24 * 60 * 60 * 1000 : d.getTime();
}

export function friendlyDueDate(iso: string | null | undefined): string {
  if (!iso) return "No deadline";
  const d = new Date(iso);
  const time = isDateOnly(d) ? "" : `, ${format(zoned(d), "h:mm a")}`;
  const days = differenceInCalendarDays(zoned(d), zoned(new Date()));
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days === -1) return `Yesterday${time}`;
  return isDateOnly(d) ? formatDate(iso) : formatDateTime(iso);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function csvEscape(v: string | number | null | undefined): string {
  let s = String(v ?? "");
  // Neutralize spreadsheet formulas (CSV injection) in text cells.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Whole taka, e.g. "৳1,250". */
export function formatBdt(amount: number): string {
  return `৳${amount.toLocaleString("en-US")}`;
}
