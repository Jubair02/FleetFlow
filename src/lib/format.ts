"use client";

import { format, formatDistanceToNow, isToday, isTomorrow, isYesterday } from "date-fns";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(new Date(iso), "d MMM yyyy, h:mm a");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(new Date(iso), "d MMM yyyy");
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(new Date(iso), "h:mm a");
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

/** A deadline at exactly local midnight was given as a date only — don't show "12:00 AM". */
export function isDateOnly(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

export function friendlyDueDate(iso: string | null | undefined): string {
  if (!iso) return "No deadline";
  const d = new Date(iso);
  const time = isDateOnly(d) ? "" : `, ${format(d, "h:mm a")}`;
  if (isToday(d)) return `Today${time}`;
  if (isTomorrow(d)) return `Tomorrow${time}`;
  if (isYesterday(d)) return `Yesterday${time}`;
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
