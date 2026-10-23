// ─────────────────────────────────────────────────────────────
// Pure helpers for the Organizations list (no React, no DOM) —
// unit tested in tests/unit/platform-org-list.test.ts.
// ─────────────────────────────────────────────────────────────

import type { PlatformOrgRow } from "@/lib/platform-types";

export const PAGE_SIZES = [10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

/**
 * Percentage change from `previous` to `current`, rounded to a whole number.
 * Null when there is no baseline (previous is 0) — the UI shows "—" instead
 * of an infinite or made-up percentage.
 */
export function trendPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** "+12%", "−8%", "0%" (true minus sign for legibility). */
export function formatTrend(pct: number): string {
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `−${Math.abs(pct)}%`;
  return "0%";
}

/**
 * Short, human-friendly reference: "ORG-" + the LAST 6 characters of the id.
 * cuid ids start with a timestamp, so their first characters are shared by
 * organizations created around the same time; the tail is the random part.
 */
export function orgShortId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9]/g, "");
  return `ORG-${clean.slice(-6).toUpperCase()}`;
}

/** Stable 32-bit FNV-1a hash (deterministic colours from ids / codes). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic index into a palette of `size` colours. */
export function paletteIndex(key: string, size: number): number {
  return size > 0 ? hashString(key) % size : 0;
}

/** One or two letters for an avatar: "Meghna Foods" → "MF", "acme" → "A". */
export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return "?";
  const first = (w: string) => (w.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toUpperCase();
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[1]);
}

/**
 * Page buttons for a pager: always the first and last page, a window of
 * `siblings` around the current one, and "ellipsis" for the gaps.
 * e.g. (6, 12) → [1, "ellipsis", 5, 6, 7, "ellipsis", 12]
 */
export function pageNumbers(page: number, pageCount: number, siblings = 1): (number | "ellipsis")[] {
  const count = Math.max(1, Math.floor(pageCount));
  const current = Math.min(Math.max(1, Math.floor(page)), count);
  // Small enough to show every page (first + last + window + 2 ellipsis slots).
  if (count <= siblings * 2 + 5) return Array.from({ length: count }, (_, i) => i + 1);
  let start = Math.max(2, current - siblings);
  let end = Math.min(count - 1, current + siblings);
  // Keep the number of buttons constant near the edges.
  if (current - siblings <= 3) {
    start = 2;
    end = 3 + siblings * 2;
  } else if (current + siblings >= count - 2) {
    start = count - 2 - siblings * 2;
    end = count - 1;
  }
  const out: (number | "ellipsis")[] = [1];
  if (start > 2) out.push("ellipsis");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < count - 1) out.push("ellipsis");
  out.push(count);
  return out;
}

/** "Showing 1–8 of 12 organizations" range (0–0 when empty). */
export function showingRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from: Math.min(from, total), to: Math.min(total, page * pageSize) };
}

/** Absolute 1-based row number across pages (the "#" column). */
export function rowNumber(page: number, pageSize: number, index: number): number {
  return (Math.max(1, page) - 1) * pageSize + index + 1;
}

// ── Filters ──────────────────────────────────────────────────

/**
 * The single "All statuses" select mixes two concepts, so its values are
 * namespaced: "org:ACTIVE" → ?status=ACTIVE, "sub:TRIAL" → ?subscription=TRIAL.
 */
export type StatusFilter = "all" | "org:ACTIVE" | "org:SUSPENDED" | "sub:TRIAL" | "sub:ACTIVE" | "sub:PAST_DUE" | "sub:CANCELLED";

export function statusFilterParams(v: StatusFilter): { status: string | null; subscription: string | null } {
  if (v.startsWith("org:")) return { status: v.slice(4), subscription: null };
  if (v.startsWith("sub:")) return { status: null, subscription: v.slice(4) };
  return { status: null, subscription: null };
}

/** Local calendar day as "YYYY-MM-DD" (what the date picker sends as ?from= / ?to=). */
export function toIsoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Export file name: fleetflow-organizations-2026-10-22.csv (local date). */
export function exportFilename(now: Date = new Date()): string {
  return `fleetflow-organizations-${toIsoDay(now)}.csv`;
}

// ── Subscription line ────────────────────────────────────────

/**
 * Second line under the subscription status — only what the data supports:
 *  ACTIVE / PAST_DUE: "Renews <date>" / "Was due <date>" when paidUntil is set
 *  CANCELLED: "Ended <date>" when paidUntil is set
 *  TRIAL: "Trial until <date>" when paidUntil is set, else "Trial started <relative>"
 * `fmt` formats an ISO date; `rel` formats a relative time ("3 days ago").
 */
export function subscriptionLine(
  row: Pick<PlatformOrgRow, "subscriptionStatus" | "paidUntil" | "createdAt">,
  fmt: (iso: string) => string,
  rel: (iso: string) => string
): string | null {
  const { subscriptionStatus: s, paidUntil } = row;
  if (s === "TRIAL") return paidUntil ? `Trial until ${fmt(paidUntil)}` : `Trial started ${rel(row.createdAt)}`;
  if (!paidUntil) return null;
  if (s === "ACTIVE") return `Renews ${fmt(paidUntil)}`;
  if (s === "PAST_DUE") return `Was due ${fmt(paidUntil)}`;
  if (s === "CANCELLED") return `Ended ${fmt(paidUntil)}`;
  return null;
}

// ── CSV ──────────────────────────────────────────────────────

const SUB_LABELS: Record<string, string> = { TRIAL: "Trial", ACTIVE: "Active", PAST_DUE: "Past due", CANCELLED: "Cancelled" };

export const ORG_CSV_HEADER = [
  "Organization ID",
  "Reference",
  "Name",
  "Contact email",
  "Plan",
  "Plan code",
  "Billing cycle",
  "Price (BDT)",
  "Subscription",
  "Paid until",
  "Status",
  "Users",
  "Active admins",
  "Active drivers",
  "Vehicles",
  "Deliveries (last 30 days)",
  "Deliveries (previous 30 days)",
  "Deliveries (total)",
  "Registered",
  "Last activity",
] as const;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * Header + one row per organization. Dates are ISO (YYYY-MM-DD) so
 * spreadsheets sort them; a free plan has an empty price. Cells are raw —
 * escaping and formula neutralisation happen in downloadCsv (src/lib/format.ts).
 */
export function orgCsvRows(rows: PlatformOrgRow[]): (string | number)[][] {
  return [
    [...ORG_CSV_HEADER],
    ...rows.map((o) => [
      o.id,
      orgShortId(o.id),
      o.name,
      o.contactEmail ?? "",
      o.planName || o.plan,
      o.plan,
      o.billingCycle === "ANNUAL" ? "Annual" : "Monthly",
      o.subscriptionPriceBdt ?? "",
      SUB_LABELS[o.subscriptionStatus] ?? o.subscriptionStatus,
      day(o.paidUntil),
      o.status === "SUSPENDED" ? "Suspended" : "Active",
      o.users,
      o.counts.admins,
      o.counts.drivers,
      o.counts.vehicles,
      o.deliveries30d,
      o.deliveriesPrev30d,
      o.counts.deliveries,
      day(o.createdAt),
      day(o.lastActivityAt),
    ]),
  ];
}
