import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-helpers";
import { PLANS } from "@/lib/plan-catalog";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { PLAN_CODES, tallyPlans } from "@/lib/platform-service";
import type { PlatformPlansData } from "@/lib/platform-types";

// GET /api/platform/plans → PlatformPlansData
export async function GET() {
  try {
    await requirePlatformAdmin();
    const rows = await db.organization.groupBy({ by: ["plan"], _count: { _all: true } });
    const { byCode, unknown } = tallyPlans(rows.map((r) => ({ plan: r.plan, count: r._count._all })));
    const body: PlatformPlansData = {
      plans: PLAN_CODES.map((code) => ({ ...PLANS[code], organizationCount: byCode[code] })),
      unknownPlanCount: unknown,
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
