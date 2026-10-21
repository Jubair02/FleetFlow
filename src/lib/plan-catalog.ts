// ─────────────────────────────────────────────────────────────
// Subscription plans & limits.
// Prices are a PROPOSED hypothesis for Bangladesh — not validated
// market data. There is no payment integration: plans are changed
// manually (see docs/BILLING.md).
//
// Client-safe: no server imports. Server-side usage and enforcement
// live in src/lib/plans.ts.
// ─────────────────────────────────────────────────────────────

export type PlanCode = "trial" | "starter" | "growth" | "business";
export type PlanResource = "drivers" | "vehicles" | "admins" | "monthlyDeliveries";

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  /** Proposed monthly price in BDT; null = not sold (trial). */
  proposedPriceBdt: number | null;
  /** null = unlimited */
  limits: Record<PlanResource, number | null>;
  highlights: string[];
}

export const PLANS: Record<PlanCode, PlanDefinition> = {
  trial: {
    code: "trial",
    name: "Trial",
    proposedPriceBdt: null,
    limits: { drivers: 10, vehicles: 10, admins: 3, monthlyDeliveries: 1000 },
    highlights: ["Everything in Growth while you evaluate", "Manual upgrade when you're ready"],
  },
  starter: {
    code: "starter",
    name: "Starter",
    proposedPriceBdt: 1500,
    limits: { drivers: 5, vehicles: 5, admins: 1, monthlyDeliveries: 500 },
    highlights: ["Dispatch, driver app & proof of delivery", "Customer tracking links", "Email notifications"],
  },
  growth: {
    code: "growth",
    name: "Growth",
    proposedPriceBdt: 4000,
    limits: { drivers: 20, vehicles: 20, admins: 3, monthlyDeliveries: 3000 },
    highlights: ["Everything in Starter", "CSV delivery import", "Performance reports & CSV export"],
  },
  business: {
    code: "business",
    name: "Business",
    proposedPriceBdt: 9000,
    limits: { drivers: 50, vehicles: 50, admins: null, monthlyDeliveries: 15000 },
    highlights: ["Everything in Growth", "Unlimited dispatchers", "Priority support & onboarding help"],
  },
};

export const RESOURCE_LABELS: Record<PlanResource, string> = {
  drivers: "active drivers",
  vehicles: "vehicles in service",
  admins: "dispatcher/admin accounts",
  monthlyDeliveries: "deliveries this month",
};

/** Unknown/legacy plan codes fall back to the trial limits rather than failing. */
export function getPlan(code: string | null | undefined): PlanDefinition {
  return PLANS[(code ?? "trial").toLowerCase() as PlanCode] ?? PLANS.trial;
}
