import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { createStaffSchema, firstError } from "@/lib/validation";
import { assertPlanLimit, getOrgPlan } from "@/lib/plans";
import { generateTempPassword } from "@/lib/account";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { STAFF_ROLES } from "@/lib/roles";

// GET /api/staff — the organization's admin and dispatcher accounts (admin)
export async function GET() {
  try {
    const user = await requireAdmin();
    const [admins, plan] = await Promise.all([
      db.user.findMany({
        where: { organizationId: user.organizationId, role: { in: [...STAFF_ROLES] } },
        select: { id: true, name: true, email: true, role: true, isOwner: true, active: true, mustChangePassword: true, lastLoginAt: true, createdAt: true },
        orderBy: [{ active: "desc" }, { isOwner: "desc" }, { createdAt: "asc" }],
      }),
      getOrgPlan(db, user.organizationId),
    ]);
    return ok({
      items: admins.map((a) => ({
        ...a,
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        isYou: a.id === user.id,
      })),
      limit: plan.limits.admins,
      activeCount: admins.filter((a) => a.active).length,
    });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/staff — add an admin or dispatcher with a temporary password (admin).
// The temporary password is returned once; the new admin must change it at first sign-in.
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = createStaffSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    const temporaryPassword = data.password ?? generateTempPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    let created;
    try {
      created = await db.$transaction(async (tx) => {
        await assertPlanLimit(tx, user.organizationId, "admins");
        const u = await tx.user.create({
          data: {
            organizationId: user.organizationId,
            name: data.name,
            email: data.email,
            passwordHash,
            role: data.role,
            mustChangePassword: true,
          },
        });
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "STAFF_CREATED", entityType: "User", entityId: u.id,
            detail: { name: data.name, email: data.email, role: data.role },
          }),
        });
        return u;
      }, TX_OPTIONS);
    } catch (e) {
      // Emails are globally unique; don't reveal whether the account is in another org.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(409, "This email can't be used for a new account");
      }
      throw e;
    }

    return ok({ success: true, userId: created.id, temporaryPassword }, 201);
  } catch (e) {
    return fail(e);
  }
}
