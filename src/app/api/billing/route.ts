import { db } from "@/lib/db";
import { ApiError, fail, ok, requireAdmin } from "@/lib/api-helpers";
import { PLANS, RESOURCE_LABELS, getPlan, getUsage } from "@/lib/plans";

// GET /api/billing — the organization's current plan, usage against its
// limits, and the full (proposed) plan catalog. Read-only: there is no
// payment integration; plan changes are applied manually (docs/BILLING.md).
export async function GET() {
  try {
    const user = await requireAdmin();
    const org = await db.organization.findUnique({
      where: { id: user.organizationId },
      select: { plan: true, timezone: true, contactEmail: true },
    });
    if (!org) throw new ApiError(404, "Organization not found");

    const plan = getPlan(org.plan);
    const usage = await getUsage(db, user.organizationId, org.timezone);

    return ok({
      plan: {
        code: plan.code,
        name: plan.name,
        proposedPriceBdt: plan.proposedPriceBdt,
        limits: plan.limits,
        highlights: plan.highlights,
      },
      usage,
      plans: Object.values(PLANS),
      resourceLabels: RESOURCE_LABELS,
      billingContact: org.contactEmail ?? null,
    });
  } catch (e) {
    return fail(e);
  }
}
