import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { onboardingSchema, firstError } from "@/lib/validation";
import { computeOnboarding } from "@/lib/onboarding";

// GET /api/onboarding — the getting-started checklist for the admin's organization
export async function GET() {
  try {
    const user = await requireAdmin();
    const organizationId = user.organizationId;
    const [org, vehicles, drivers, deliveries, assignments, admins] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { phone: true, address: true, defaultPickupAddress: true, onboardingDismissedAt: true },
      }),
      db.vehicle.count({ where: { organizationId } }),
      db.user.count({ where: { organizationId, role: "DRIVER" } }),
      db.delivery.count({ where: { organizationId } }),
      db.assignment.count({ where: { delivery: { organizationId } } }),
      db.user.count({ where: { organizationId, role: "ADMIN" } }),
    ]);
    if (!org) throw new ApiError(404, "Organization not found");
    return ok(computeOnboarding({ org, vehicles, drivers, deliveries, assignments, admins }));
  } catch (e) {
    return fail(e);
  }
}

// POST /api/onboarding — { dismissed: true } hides the checklist; false brings it back (admin)
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = onboardingSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    await db.organization.update({
      where: { id: user.organizationId },
      data: { onboardingDismissedAt: parsed.data.dismissed ? new Date() : null },
    });
    return ok({ success: true, dismissed: parsed.data.dismissed });
  } catch (e) {
    return fail(e);
  }
}
