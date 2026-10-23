// ─────────────────────────────────────────────────────────────
// Pure helpers for the organization dialog (no React, no DOM) —
// unit tested in tests/unit/platform-org-dialog.test.ts.
// ─────────────────────────────────────────────────────────────

import type { OrgProfileInput, PlatformAuditRow, PlatformOrgDetail } from "@/lib/platform-types";

/** Centered dialog on ≥ sm; a bottom sheet (scrolls inside) on phones. */
export const SHEET_ON_PHONE =
  "max-h-[92dvh] overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]";

/** Centered dialog on ≥ sm; full height on phones. */
export const FULL_ON_PHONE =
  "max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0";

/** Common zones for FleetFlow customers (same list as the company settings page). */
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

/** "Renews 30 Nov 2026" / "Ends …" (cancelled, still paid) / "Ended …"; null without a paid-until date. */
export function renewalLabel(paidUntil: string | null, subscriptionStatus: string, now: Date, fmt: (iso: string) => string): string | null {
  if (!paidUntil) return null;
  const at = new Date(paidUntil);
  if (Number.isNaN(at.getTime())) return null;
  if (at.getTime() < now.getTime()) return `Ended ${fmt(paidUntil)}`;
  return `${subscriptionStatus === "CANCELLED" ? "Ends" : "Renews"} ${fmt(paidUntil)}`;
}

/** 96.4 → "96.4%", 100 → "100%", null → "—". */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
}

// ── Edit organization ────────────────────────────────────────

export type ProfileField = "name" | "contactEmail" | "phone" | "address" | "defaultPickupAddress" | "timezone";
export type ProfileForm = Record<ProfileField, string>;
export type ProfileErrors = Partial<Record<ProfileField, string>>;

export const PROFILE_LABELS: Record<ProfileField, string> = {
  name: "Company name",
  contactEmail: "Contact email",
  phone: "Phone",
  address: "Address",
  defaultPickupAddress: "Default pickup address",
  timezone: "Timezone",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function profileFormFrom(org: PlatformOrgDetail["organization"]): ProfileForm {
  return {
    name: org.name,
    contactEmail: org.contactEmail ?? "",
    phone: org.phone ?? "",
    address: org.address ?? "",
    defaultPickupAddress: org.defaultPickupAddress ?? "",
    timezone: org.timezone,
  };
}

/** Client-side mirror of the server rules (the server re-validates everything). */
export function validateProfile(f: ProfileForm, validTimezone: (tz: string) => boolean): ProfileErrors {
  const e: ProfileErrors = {};
  const name = f.name.trim();
  if (name.length < 2) e.name = "Company name must be at least 2 characters";
  else if (name.length > 120) e.name = "Company name must be 120 characters or fewer";
  const email = f.contactEmail.trim();
  if (email && (!EMAIL.test(email) || email.length > 254)) e.contactEmail = "Enter a valid contact email";
  const phone = f.phone.trim();
  if (phone && (phone.length < 6 || phone.length > 30)) e.phone = "Phone must be 6–30 characters";
  if (f.address.trim().length > 300) e.address = "Address must be 300 characters or fewer";
  if (f.defaultPickupAddress.trim().length > 300) e.defaultPickupAddress = "Default pickup address must be 300 characters or fewer";
  if (!f.timezone.trim() || !validTimezone(f.timezone.trim())) e.timezone = "Select a valid timezone";
  return e;
}

/** Only the fields that differ from the loaded profile; cleared optional fields become null. */
export function changedProfile(initial: ProfileForm, f: ProfileForm): OrgProfileInput {
  const out: OrgProfileInput = {};
  const name = f.name.trim();
  if (name !== initial.name.trim()) out.name = name;
  const tz = f.timezone.trim();
  if (tz !== initial.timezone) out.timezone = tz;
  const email = f.contactEmail.trim().toLowerCase();
  if (email !== initial.contactEmail.trim().toLowerCase()) out.contactEmail = email || null;
  for (const key of ["phone", "address", "defaultPickupAddress"] as const) {
    const v = f[key].trim();
    if (v !== initial[key].trim()) out[key] = v || null;
  }
  return out;
}

// ── Activity ─────────────────────────────────────────────────

export interface ActivityItem {
  id: string;
  source: "company" | "platform";
  action: string;
  actorName: string | null;
  /** Entity type (company rows) or the raw detail JSON (platform rows). */
  entityType: string | null;
  detail: string | null;
  createdAt: string;
}

/** Company audit rows and platform actions in one newest-first timeline. */
export function mergeActivity(
  recent: PlatformOrgDetail["recentActivity"],
  platform: PlatformAuditRow[]
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...recent.map((a) => ({ id: `c-${a.id}`, source: "company" as const, action: a.action, actorName: a.actorName, entityType: a.entityType, detail: null, createdAt: a.createdAt })),
    ...platform.map((a) => ({ id: `p-${a.id}`, source: "platform" as const, action: a.action, actorName: a.actorName, entityType: null, detail: a.detail, createdAt: a.createdAt })),
  ];
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
}
