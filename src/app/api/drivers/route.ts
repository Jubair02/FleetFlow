import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { assertPlanLimit } from "@/lib/plans";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { createDriverSchema, firstError } from "@/lib/validation";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { toDriverDTO } from "@/lib/serializers";

// GET /api/drivers — org drivers with workload (admin)
export async function GET() {
  try {
    const user = await requireAdmin();
    const orgDriver = { driver: { organizationId: user.organizationId } };

    const [drivers, activeCounts, outcomeCounts] = await Promise.all([
      db.user.findMany({
        where: { organizationId: user.organizationId, role: "DRIVER" },
        include: { driverProfile: true },
        orderBy: { name: "asc" },
      }),
      db.assignment.groupBy({
        by: ["driverId"],
        where: { ...orgDriver, active: true },
        _count: { _all: true },
      }),
      // per-driver totals from how each of THEIR assignments ended
      db.assignment.groupBy({
        by: ["driverId", "outcome"],
        where: { ...orgDriver, outcome: { in: ["DELIVERED", "FAILED"] } },
        _count: { _all: true },
      }),
    ]);

    const activeMap = new Map(activeCounts.map((c) => [c.driverId, c._count._all]));
    const perDriver = new Map<string, { completed: number; failed: number }>();
    for (const c of outcomeCounts) {
      const cur = perDriver.get(c.driverId) ?? { completed: 0, failed: 0 };
      if (c.outcome === "DELIVERED") cur.completed += c._count._all;
      if (c.outcome === "FAILED") cur.failed += c._count._all;
      perDriver.set(c.driverId, cur);
    }

    const items = drivers
      .map((d) => {
        const st = perDriver.get(d.id) ?? { completed: 0, failed: 0 };
        return toDriverDTO(d, activeMap.get(d.id) ?? 0, st.completed, st.failed);
      })
      .filter(Boolean);

    return ok({ items });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/drivers — create driver account (admin)
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = createDriverSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    // Hash outside the transaction so the connection isn't held during scrypt.
    const passwordHash = await hashPassword(data.password);

    let driver;
    try {
      driver = await db.$transaction(async (tx) => {
        await assertPlanLimit(tx, user.organizationId, "drivers");
        const u = await tx.user.create({
          data: {
            organizationId: user.organizationId,
            name: data.name,
            email: data.email,
            passwordHash,
            role: "DRIVER",
            mustChangePassword: true, // admin chose it — the driver sets their own on first sign-in
          },
        });
        await tx.driverProfile.create({
          data: {
            userId: u.id,
            phone: data.phone,
            licenseNumber: data.licenseNumber,
            maxActiveJobs: data.maxActiveJobs,
          },
        });
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "DRIVER_CREATED", entityType: "User", entityId: u.id,
            detail: { name: data.name, email: data.email },
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

    return ok({ success: true, driverId: driver.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
