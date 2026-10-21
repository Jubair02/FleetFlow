// ─────────────────────────────────────────────────────────────
// Frontend API contract types for company settings, staff and
// onboarding (mirror of /api/org, /api/staff, /api/onboarding).
// ─────────────────────────────────────────────────────────────

/** GET /api/org → { organization } */
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
