import { db } from "@/lib/db";
import { ApiError, fail, ok, requireAdmin } from "@/lib/api-helpers";
import { RESOURCE_LABELS, getUsage, listPlans, listPrice, toPlanDefinition } from "@/lib/plans";
import { toBillingCycle } from "@/lib/platform-service";

// GET /api/billing — the organization's current plan (live limits & features),
// usage against its limits, its subscription (agreed price snapshot, cycle,
// status) and the active public plans. Read-only: there is no payment
// integration; plan changes are applied manually (docs/BILLING.md).
export async function GET() {
  try {
    const user = await requireAdmin();
    const org = await db.organization.findUnique({
      where: { id: user.organizationId },
      select: {
        timezone: true,
        contactEmail: true,
        subscriptionStatus: true,
        paidUntil: true,
        billingCycle: true,
        subscriptionPriceBdt: true,
        planAssignedAt: true,
        planRecord: true,
      },
    });
    if (!org) throw new ApiError(404, "Organization not found");

    const plan = toPlanDefinition(org.planRecord);
    const billingCycle = toBillingCycle(org.billingCycle);
    const [usage, plans] = await Promise.all([
      getUsage(db, user.organizationId, org.timezone),
      listPlans(db, { activeOnly: true, publicOnly: true }),
    ]);

    return ok({
      plan,
      usage,
      plans,
      billingContact: org.contactEmail ?? null,
      resourceLabels: RESOURCE_LABELS,
      subscription: {
        status: org.subscriptionStatus,
        billingCycle,
        priceBdt: org.subscriptionPriceBdt,
        paidUntil: org.paidUntil?.toISOString() ?? null,
        planAssignedAt: org.planAssignedAt.toISOString(),
        listPriceBdt: listPrice(plan, billingCycle),
      },
    });
  } catch (e) {
    return fail(e);
  }
}
