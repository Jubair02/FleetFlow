// ─────────────────────────────────────────────────────────────
// Plan types, feature catalog & labels — client-safe (no server imports).
//
// Plans themselves live in the database (model Plan) and are edited by
// platform admins in the /platform console. Prices are a PROPOSED
// hypothesis for Bangladesh, not validated market data. Billing is manual
// (docs/BILLING.md); there is no payment integration.
// Server-side loading & enforcement: src/lib/plans.ts.
// ─────────────────────────────────────────────────────────────

/** Plan code = Plan.code (lowercase slug, immutable once created). */
export type PlanCode = string;
export type PlanResource = "drivers" | "vehicles" | "admins" | "monthlyDeliveries";
export type BillingCycle = "MONTHLY" | "ANNUAL";

/**
 * Feature keys a plan can grant. Only features that are actually gated on
 * the server are listed here — adding a key without enforcing it would
 * promise something the product doesn't do.
 */
export const FEATURES = {
  csv_import: { label: "CSV delivery import", description: "Bulk-import deliveries from a spreadsheet" },
  report_export: { label: "Report CSV export", description: "Download delivery and driver performance reports" },
  customer_emails: { label: "Customer emails", description: "Email recipients their tracking link and delivery outcome" },
} as const;
export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  description: string | null;
  /** Monthly list price in BDT; null = not sold monthly (e.g. trial). */
  monthlyPriceBdt: number | null;
  /** Annual list price in BDT; null = no annual option. */
  annualPriceBdt: number | null;
  /** null = unlimited */
  limits: Record<PlanResource, number | null>;
  features: FeatureKey[];
  highlights: string[];
  /** Inactive plans can't be newly assigned; existing subscribers keep them. */
  active: boolean;
  /** Shown on the public pricing table. */
  isPublic: boolean;
  /** Given to self-service sign-ups. Exactly one plan is the default. */
  isDefault: boolean;
  sortOrder: number;
}

export const RESOURCE_LABELS: Record<PlanResource, string> = {
  drivers: "active drivers",
  vehicles: "vehicles in service",
  admins: "dispatcher/admin accounts",
  monthlyDeliveries: "deliveries this month",
};

export const PLAN_RESOURCES = Object.keys(RESOURCE_LABELS) as PlanResource[];

export function planHasFeature(plan: Pick<PlanDefinition, "features">, feature: FeatureKey): boolean {
  return plan.features.includes(feature);
}

/** List price for a cycle (null = not offered on that cycle). */
export function listPrice(plan: Pick<PlanDefinition, "monthlyPriceBdt" | "annualPriceBdt">, cycle: BillingCycle): number | null {
  return cycle === "ANNUAL" ? plan.annualPriceBdt : plan.monthlyPriceBdt;
}
