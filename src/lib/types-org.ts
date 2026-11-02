import type { StaffRole } from "@/lib/roles";
// ─────────────────────────────────────────────────────────────
// Frontend API contract types for company settings, staff and
// onboarding (mirror of /api/org, /api/staff, /api/onboarding).
// ─────────────────────────────────────────────────────────────

import type { FeatureKey } from "@/lib/plan-catalog";

/** GET /api/org → { organization, planInfo }; PATCH /api/org → { organization } */
export interface OrgSettings {
  id: string;
  name: string;
  plan: string;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  defaultPickupAddress: string | null;
  /** Depot / default pickup point on the map (route planning starts here). */
  pickupLat?: number | null;
  pickupLng?: number | null;
  timezone: string;
  createdAt: string;
}

/** The organization's plan as far as the company UI needs it (feature gating). */
export interface OrgPlanInfo {
  code: string;
  name: string;
  /** Features the plan includes; anything missing is refused by the server (403). */
  features: FeatureKey[];
}

/** GET /api/org */
export interface OrgSettingsResponse {
  organization: OrgSettings;
  planInfo: OrgPlanInfo;
}

export type OnboardingStepKey = "company" | "vehicle" | "driver" | "delivery" | "assign" | "team";

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  description: string;
  done: boolean;
  /** Optional steps don't count towards `allDone`. */
  optional: boolean;
}

/** GET /api/onboarding */
export interface OnboardingData {
  steps: OnboardingStep[];
  dismissed: boolean;
  allDone: boolean;
}

/** GET /api/staff → { items, limit, activeCount } */
export interface StaffItem {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  /** The account that created the company — other admins can't change it. */
  isOwner: boolean;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** True for the signed-in admin's own row. */
  isYou: boolean;
}

export interface StaffList {
  items: StaffItem[];
  /** Plan limit for active admins + dispatchers; null = unlimited. */
  limit: number | null;
  activeCount: number;
}

/** Returned once by every endpoint that sets a temporary password. */
export interface TempPasswordResult {
  temporaryPassword: string;
}

// GET /api/cod — cash on delivery overview (whole BDT)
export interface CodSummary {
  totals: {
    /** Collected by drivers, not yet handed over. */
    cashWithDrivers: number;
    collectedToday: number;
    collectedTodayCount: number;
    settledToday: number;
    /** COD still due on deliveries that aren't finished. */
    toCollect: number;
    toCollectCount: number;
  };
  drivers: {
    driverId: string;
    name: string;
    phone: string | null;
    active: boolean;
    cashInHand: number;
    deliveries: number;
    oldestCollectedAt: string | null;
  }[];
  /** Collected less than was due (last 30 days). */
  short: {
    deliveryId: string;
    trackingCode: string;
    recipientName: string;
    codAmount: number;
    collected: number;
    driverName: string | null;
    collectedAt: string;
  }[];
  settlements: {
    id: string;
    driverName: string;
    amount: number;
    deliveryCount: number;
    receivedByName: string;
    note: string | null;
    createdAt: string;
  }[];
}
