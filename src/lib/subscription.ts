// ─────────────────────────────────────────────────────────────
// Subscription access rules — client-safe (no server imports).
//
// A company's access ends when its trial ends (TRIAL) or its paid period
// runs out (ACTIVE / PAST_DUE / CANCELLED with paidUntil). Then:
//   1. GRACE for 7 days — everything still works, banners warn.
//   2. READ_ONLY afterwards — staff can view, export and finish deliveries
//      already under way, but can't create, import, assign or add drivers,
//      vehicles or staff (enforced in src/lib/plans.ts → assertCanGrow).
// Suspension (Organization.status) is separate and stays a manual
// platform-admin action. Billing is manual (docs/BILLING.md).
// ─────────────────────────────────────────────────────────────

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
/** Banners start this many days before access ends. */
export const WARN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessState = "OK" | "ENDING_SOON" | "GRACE" | "READ_ONLY";

export interface SubscriptionFields {
  subscriptionStatus: string; // TRIAL | ACTIVE | PAST_DUE | CANCELLED
  trialEndsAt: Date | string | null;
  paidUntil: Date | string | null;
}

export interface SubscriptionAccess {
  state: AccessState;
  /** TRIAL while on the free trial; PAID otherwise. */
  kind: "TRIAL" | "PAID";
  /** When access ends (trial end / paid-until), or null when it doesn't. */
  endsAt: string | null;
  /** When read-only starts (endsAt + grace), or null. */
  readOnlyAt: string | null;
  /** Whole days until endsAt (ENDING_SOON) or until read-only (GRACE); 0 otherwise. */
  daysLeft: number;
}

function toDate(d: Date | string | null): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function trialEndFrom(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * DAY_MS);
}

export function subscriptionAccess(org: SubscriptionFields, now: Date = new Date()): SubscriptionAccess {
  const kind = org.subscriptionStatus === "TRIAL" ? "TRIAL" : "PAID";
  let end = kind === "TRIAL" ? toDate(org.trialEndsAt) : toDate(org.paidUntil);
  // Past due or cancelled with no paid-until date: access has already ended.
  if (!end && (org.subscriptionStatus === "PAST_DUE" || org.subscriptionStatus === "CANCELLED")) end = now;
  if (!end) return { state: "OK", kind, endsAt: null, readOnlyAt: null, daysLeft: 0 };

  const readOnly = new Date(end.getTime() + GRACE_DAYS * DAY_MS);
  const base = { kind, endsAt: end.toISOString(), readOnlyAt: readOnly.toISOString() } as const;
  const daysUntil = (d: Date) => Math.max(0, Math.ceil((d.getTime() - now.getTime()) / DAY_MS));

  if (now >= readOnly) return { ...base, state: "READ_ONLY", daysLeft: 0 };
  if (now >= end) return { ...base, state: "GRACE", daysLeft: daysUntil(readOnly) };
  if (end.getTime() - now.getTime() <= WARN_DAYS * DAY_MS) return { ...base, state: "ENDING_SOON", daysLeft: daysUntil(end) };
  return { ...base, state: "OK", daysLeft: 0 };
}

/** The message shown when a read-only company tries to add something. */
export function readOnlyMessage(access: SubscriptionAccess): string {
  return access.kind === "TRIAL"
    ? "Your FleetFlow trial has ended, so your account is read-only. You can still view, export and complete deliveries already under way. Contact FleetFlow to subscribe."
    : "Your FleetFlow subscription has lapsed, so your account is read-only. You can still view, export and complete deliveries already under way. Contact FleetFlow to renew.";
}
