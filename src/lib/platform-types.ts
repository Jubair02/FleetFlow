// ─────────────────────────────────────────────────────────────
// Platform (super admin) API contract — shared by /api/platform/* and
// the /platform console. All endpoints except auth/login require a
// platform session (requirePlatformAdmin in src/lib/platform-auth.ts).
// List endpoints accept ?page (1-based) and return Paged<T>.
// ─────────────────────────────────────────────────────────────

import type { PlanCode, PlanDefinition, PlanResource } from "@/lib/plan-catalog";

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
  subscriptionStatus: SubscriptionStatus;
  paidUntil: string | null;
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
    phone: string | null;
    contactEmail: string | null;
    address: string | null;
    timezone: string;
    createdAt: string;
  };
  usage: Record<PlanResource, number>;
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
  | { action: "set-plan"; plan: PlanCode }
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

// GET /api/platform/plans
export interface PlatformPlansData {
  plans: (PlanDefinition & { organizationCount: number })[];
  /** Organizations whose stored plan code isn't in the catalog (treated as trial). */
  unknownPlanCount: number;
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
