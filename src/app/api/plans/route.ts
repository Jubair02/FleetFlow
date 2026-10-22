import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-helpers";
import { listPlans } from "@/lib/plans";
import type { PlanDefinition } from "@/lib/plan-catalog";

// GET /api/plans — PUBLIC (no auth): the active, public plans in sortOrder,
// for the sign-up pricing table. Contains only catalog data — no subscriber
// counts or anything organization-specific.
export async function GET() {
  try {
    const plans: PlanDefinition[] = await listPlans(db, { activeOnly: true, publicOnly: true });
    return ok({ plans });
  } catch (e) {
    return fail(e);
  }
}
