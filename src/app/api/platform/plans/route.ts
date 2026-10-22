import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { TX_OPTIONS } from "@/lib/delivery";
import { listPlans, toPlanDefinition } from "@/lib/plans";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { parseBody, planAuditData, planCreateSchema, planFieldsToData, summarizePlans } from "@/lib/platform-service";

// GET /api/platform/plans → PlatformPlansData (all plans incl. inactive, in sortOrder)
export async function GET() {
  try {
    await requirePlatformAdmin();
    const [plans, groups] = await Promise.all([
      listPlans(db),
      db.organization.groupBy({ by: ["plan", "billingCycle", "subscriptionPriceBdt"], _count: { _all: true } }),
    ]);
    return ok(
      summarizePlans(
        plans,
        groups.map((g) => ({ plan: g.plan, billingCycle: g.billingCycle, subscriptionPriceBdt: g.subscriptionPriceBdt, count: g._count._all }))
      )
    );
  } catch (e) {
    return fail(e);
  }
}

// POST /api/platform/plans — PlanInput → { plan: PlanDefinition } (201).
// New plans start active and not default. Codes are immutable; there is no delete.
export async function POST(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const input = parseBody(planCreateSchema, await readJson<unknown>(req));

    try {
      const plan = await db.$transaction(async (tx) => {
        const exists = await tx.plan.findUnique({ where: { code: input.code }, select: { code: true } });
        if (exists) throw new ApiError(409, `A plan with the code "${input.code}" already exists`);
        const created = await tx.plan.create({
          data: { code: input.code, ...planFieldsToData(input), active: true, isDefault: false },
        });
        const def = toPlanDefinition(created);
        await tx.platformAuditLog.create({
          data: planAuditData({ actor: admin, action: "PLAN_CREATED", code: created.code, detail: { plan: def }, ip: clientIp(req) }),
        });
        return def;
      }, TX_OPTIONS);
      return ok({ plan }, 201);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(409, `A plan with the code "${input.code}" already exists`);
      }
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
