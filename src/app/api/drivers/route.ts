import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { createDriverSchema, firstError } from "@/lib/validation";
import { auditData } from "@/lib/notify";
import { toDriverDTO } from "@/lib/serializers";

// GET /api/drivers — org drivers with workload (admin)
export async function GET() {
  try {
    const user = await requireAdmin();
    const drivers = await db.user.findMany({
      where: { organizationId: user.organizationId, role: "DRIVER" },
      include: { driverProfile: true },
      orderBy: { name: "asc" },
    });

    const counts = await db.assignment.groupBy({
      by: ["driverId"],
      where: { active: true },
      _count: true,
    });
    const activeMap = new Map(counts.map((c) => [c.driverId, c._count]));

    // per-driver completed/failed totals
    const stats = await db.assignment.findMany({
      where: { driver: { organizationId: user.organizationId } },
      select: { driverId: true, delivery: { select: { status: true } } },
    });
    const perDriver = new Map<string, { completed: number; failed: number }>();
    for (const s of stats) {
      const cur = perDriver.get(s.driverId) ?? { completed: 0, failed: 0 };
      if (s.delivery.status === "DELIVERED") cur.completed++;
      if (s.delivery.status === "FAILED") cur.failed++;
      perDriver.set(s.driverId, cur);
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

    const existing = await db.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existing) throw new ApiError(409, "A user with this email already exists");

    const driver = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          organizationId: user.organizationId,
          name: data.name,
          email: data.email.toLowerCase(),
          passwordHash: hashPassword(data.password),
          role: "DRIVER",
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
    });

    return ok({ success: true, driverId: driver.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
