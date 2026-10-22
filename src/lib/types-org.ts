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
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** True for the signed-in admin's own row. */
  isYou: boolean;
}

export interface StaffList {
  items: StaffItem[];
  /** Plan limit for active admins; null = unlimited. */
  limit: number | null;
  activeCount: number;
}

/** Returned once by every endpoint that sets a temporary password. */
export interface TempPasswordResult {
  temporaryPassword: string;
}
