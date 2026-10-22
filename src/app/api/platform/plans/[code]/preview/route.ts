import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { previewLimitImpact } from "@/lib/plans";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { parseBody, planPreviewSchema } from "@/lib/platform-service";
import type { LimitImpactRow } from "@/lib/platform-types";

type Params = { params: Promise<{ code: string }> };

// POST /api/platform/plans/[code]/preview { limits } → { impact: LimitImpactRow[] }
// Read-only: which subscribers would be over the proposed limits. Nothing is changed.
export async function POST(req: Request, { params }: Params) {
  try {
    await requirePlatformAdmin();
    const code = (await params).code.trim().toLowerCase();
    const { limits } = parseBody(planPreviewSchema, await readJson<unknown>(req));
    const plan = await db.plan.findUnique({ where: { code }, select: { code: true } });
    if (!plan) throw new ApiError(404, "Plan not found");
    const impact: LimitImpactRow[] = await previewLimitImpact(db, code, limits);
    return ok({ impact });
  } catch (e) {
    return fail(e);
  }
}
