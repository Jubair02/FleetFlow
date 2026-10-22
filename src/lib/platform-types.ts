// ─────────────────────────────────────────────────────────────
// Platform (super admin) API contract — shared by /api/platform/* and
// the /platform console. All endpoints except auth/login require a
// platform session (requirePlatformAdmin in src/lib/platform-auth.ts).
// List endpoints accept ?page (1-based) and return Paged<T>.
// ─────────────────────────────────────────────────────────────

import type { BillingCycle, FeatureKey, PlanCode, PlanDefinition, PlanResource } from "@/lib/plan-catalog";

export type OrgStatus = "ACTIVE" | "SUSPENDED";
export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// POST /api/platform/auth/login {email, password} → { admin }
// POST /api/platform/auth/logout → { success }
// GET  /api/platform/auth/me → { admin: PlatformAdminInfo | null }
// POST /api/platform/auth/password {currentPassword, newPassword} → { admin }
export interface PlatformAdminInfo {
  id: string;
  name: string;
  email: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// GET /api/platform/overview
export interface PlatformOverview {
  organizations: {
    total: number;
    active: number;
    suspended: number;
    byPlan: { plan: string; count: number }[];
    bySubscription: { status: string; count: number }[];
  };
  users: { total: number; admins: number; drivers: number; inactive: number };
  vehicles: number;
  deliveries: {
    total: number;
    thisMonth: number;
    byStatus: { status: string; count: number }[];
  };
  /** Last 12 calendar months (UTC), oldest first. */
  monthly: { month: string; organizations: number; deliveries: number }[];
  /** Last 30 days (UTC), oldest first. */
  daily: { date: string; deliveries: number }[];
  /** Busiest organizations this calendar month (max 5). */
  topOrganizations: { id: string; name: string; deliveriesThisMonth: number }[];
}

// GET /api/platform/organizations?search=&status=&plan=&page=
export interface PlatformOrgRow {
  id: string;
  name: string;
  status: OrgStatus;
  plan: string;
  planName: string;
  subscriptionStatus: SubscriptionStatus;
  paidUntil: string | null;
  billingCycle: BillingCycle;
  /** Agreed price per cycle (snapshot at assignment); null = free. */
  subscriptionPriceBdt: number | null;
  createdAt: string;
  counts: { admins: number; drivers: number; vehicles: number; deliveries: number; deliveriesThisMonth: number };
  lastActivityAt: string | null;
}

// POST /api/platform/organizations {companyName, adminName, adminEmail, plan, phone?}
export interface CreateOrgResult {
  organizationId: string;
  adminEmail: string;
  /** Shown once to the super admin; the company admin must change it at first sign-in. */
  temporaryPassword: string;
}

// GET /api/platform/organizations/[id]
export interface PlatformOrgDetail {
  organization: {
    id: string;
    name: string;
    status: OrgStatus;
    suspendedAt: string | null;
    suspendedReason: string | null;
    plan: string;
    subscriptionStatus: SubscriptionStatus;
    paidUntil: string | null;
    billingNotes: string | null;
    billingCycle: BillingCycle;
    subscriptionPriceBdt: number | null;
    planAssignedAt: string;
    phone: string | null;
    contactEmail: string | null;
    address: string | null;
    timezone: string;
    createdAt: string;
  };
  usage: Record<PlanResource, number>;
  /** The organization's current plan (live limits & features). */
  planDetail: PlanDefinition;
  /** Current list price for the org's cycle, to show whether it's grandfathered. */
  currentListPriceBdt: number | null;
  limits: Record<PlanResource, number | null>;
  users: PlatformUserRow[];
  /** Latest company audit entries (tenant AuditLog), max 20. */
  recentActivity: { id: string; action: string; actorName: string | null; entityType: string; createdAt: string }[];
  /** Latest platform actions on this organization, max 20. */
  platformActions: PlatformAuditRow[];
}

// PATCH /api/platform/organizations/[id]
export type OrgAction =
  | { action: "suspend"; reason: string }
  | { action: "reactivate" }
  /**
   * Assign a plan. The price snapshot defaults to the plan's list price for the
   * chosen cycle; `priceBdt` records a negotiated price instead. Only ACTIVE
   * plans can be newly assigned.
   */
  | { action: "set-plan"; plan: PlanCode; billingCycle: BillingCycle; priceBdt?: number | null }
  | { action: "update-subscription"; subscriptionStatus: SubscriptionStatus; paidUntil: string | null; billingNotes: string | null };

// GET /api/platform/users?search=&role=&status=&organizationId=&page=
export interface PlatformUserRow {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "DRIVER";
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  organization: { id: string; name: string; status: OrgStatus };
}

// PATCH /api/platform/users/[id] {action} → { success, temporaryPassword? }
export type UserAction = { action: "deactivate" | "activate" | "reset-password" | "revoke-sessions" };

// GET /api/platform/plans — all plans incl. inactive, in sortOrder
export interface PlatformPlansData {
  plans: (PlanDefinition & {
    organizationCount: number;
    /** Subscribers whose snapshot price differs from the current list price. */
    grandfatheredCount: number;
  })[];
}

/** Body of POST /api/platform/plans (create) and PATCH /api/platform/plans/[code] (update; code immutable). */
export interface PlanInput {
  code: string; // create only: lowercase a-z, 0-9, "-" (2–32 chars)
  name: string;
  description: string | null;
  monthlyPriceBdt: number | null;
  annualPriceBdt: number | null;
  limits: Record<PlanResource, number | null>;
  features: FeatureKey[];
  highlights: string[];
  isPublic: boolean;
  sortOrder: number;
}

/**
 * PATCH /api/platform/plans/[code]:
 *  - { action: "update", plan: Omit<PlanInput,"code">, confirmImpact?: boolean }
 *      If the new limits would put existing subscribers over a limit, the API
 *      responds 409 { error, impact: LimitImpactRow[] } unless confirmImpact=true.
 *  - { action: "activate" } | { action: "deactivate" }   (the default plan can't be deactivated)
 *  - { action: "make-default" }                          (target must be active)
 *  - { action: "apply-price-to-subscribers", billingCycle } → { updated: number }
 *      Re-snapshots every subscriber on that cycle to the current list price.
 * POST /api/platform/plans/[code]/preview { limits } → { impact: LimitImpactRow[] } (no changes)
 */
export interface LimitImpactRow {
  organizationId: string;
  organizationName: string;
  over: { resource: PlanResource; usage: number; limit: number }[];
}

// GET /api/platform/audit?action=&organizationId=&page=
export interface PlatformAuditRow {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  detail: string | null;
  createdAt: string;
}

// GET /api/platform/settings
export interface PlatformSettingsData {
  admin: PlatformAdminInfo;
  platformAdmins: (PlatformAdminInfo & { active: boolean })[];
  environment: {
    emailProvider: string;
    emailConfigured: boolean;
    signupEnabled: boolean;
    demoMode: boolean;
  };
}
