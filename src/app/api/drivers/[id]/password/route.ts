import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { resetPasswordSchema, firstError } from "@/lib/validation";
import { generateTempPassword } from "@/lib/account";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// POST /api/drivers/[id]/password — admin sets a temporary password for a driver.
// The driver is signed out everywhere and must choose a new password at next sign-in.
// The temporary password is returned once and never stored in plain text.
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const parsed = resetPasswordSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));

    const driver = await db.user.findFirst({
      where: { id, organizationId: user.organizationId, role: "DRIVER" },
      select: { id: true, name: true, email: true },
    });
    if (!driver) throw new ApiError(404, "Driver not found");

    const temporaryPassword = parsed.data.password ?? generateTempPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    await db.$transaction(async (tx) => {
      // updateMany keeps the org scope in the write itself.
      const updated = await tx.user.updateMany({
        where: { id: driver.id, organizationId: user.organizationId, role: "DRIVER" },
        data: { passwordHash, mustChangePassword: true },
      });
      if (updated.count !== 1) throw new ApiError(404, "Driver not found");
      await tx.session.deleteMany({ where: { userId: driver.id } });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "DRIVER_PASSWORD_RESET", entityType: "User", entityId: driver.id,
          detail: { name: driver.name, email: driver.email, generated: !parsed.data.password },
        }),
      });
    }, TX_OPTIONS);

    return ok({ temporaryPassword });
  } catch (e) {
    return fail(e);
  }
}
