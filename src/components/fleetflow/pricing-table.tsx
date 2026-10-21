import { PlanCards } from "@/components/fleetflow/plan-panel";
import { PLANS, RESOURCE_LABELS } from "@/lib/plan-catalog";

/**
 * Public pricing: the three paid tiers with limits and highlights, labelled as
 * proposed. Needs no session — data comes straight from src/lib/plan-catalog.ts (client-safe).
 * No hooks / no "use client", so it renders in a Server Component; the cards
 * themselves are a client component fed with plain (serializable) plan data.
 */
export function PricingTable() {
  return <PlanCards plans={Object.values(PLANS)} resourceLabels={RESOURCE_LABELS} />;
}
