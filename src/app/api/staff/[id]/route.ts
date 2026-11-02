import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { updateStaffSchema, firstError } from "@/lib/validation";
import { assertPlanLimit } from "@/lib/plans";
import { generateTempPassword } from "@/lib/account";
import { table, TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { STAFF_ROLES } from "@/lib/roles";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/staff/[id] — { action: "activate" | "deactivate" | "reset-password" }
// or { action: "set-role", role: "ADMIN" | "DISPATCHER" } (admin). The owner can't be
// deactivated, reset or demoted by anyone else.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const parsed = updateStaffSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const input = parsed.data;
    const { action } = input;

    if (id === user.id) {
      throw new ApiError(
        400,
        action === "reset-password"
          ? "Use “Change password” in your account menu to change your own password"
          : action === "set-role"
            ? "You can't change your own role"
            : "You can't deactivate your own account"
      );
    }

    // Hash outside the transaction so the connection isn't held during scrypt.
    const temporaryPassword = action === "reset-password" ? generateTempPassword() : null;
    const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

    await db.$transaction(async (tx) => {
      // Serialize admin-count changes per organization (assertPlanLimit takes the same lock).
      await tx.$queryRaw`SELECT id FROM ${table("Organization")} WHERE id = ${user.organizationId} FOR UPDATE`;
      const target = await tx.user.findFirst({
        where: { id, organizationId: user.organizationId, role: { in: [...STAFF_ROLES] } },
        select: { id: true, name: true, email: true, role: true, isOwner: true, active: true },
      });
      if (!target) throw new ApiError(404, "Team member not found");
      if (target.isOwner && action !== "activate") {
        throw new ApiError(403, "The company owner's account can only be changed by the owner");
      }
      // The company must always keep at least one active admin.
      const otherActiveAdmins = () =>
        tx.user.count({ where: { organizationId: user.organizationId, role: "ADMIN", active: true, id: { not: target.id } } });

      const audit = (auditAction: string) =>
        tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: auditAction, entityType: "User", entityId: target.id,
            detail: { name: target.name, email: target.email },
          }),
        });

      if (action === "deactivate") {
        if (!target.active) return;
        if (target.role === "ADMIN" && (await otherActiveAdmins()) === 0) {
          throw new ApiError(409, "You can't deactivate the last active admin");
        }
        await tx.user.update({ where: { id: target.id }, data: { active: false } });
        await tx.session.deleteMany({ where: { userId: target.id } }); // sign out immediately
        await audit("STAFF_DEACTIVATED");
      } else if (action === "activate") {
        if (target.active) return;
        await assertPlanLimit(tx, user.organizationId, "admins");
        await tx.user.update({ where: { id: target.id }, data: { active: true } });
        await audit("STAFF_REACTIVATED");
      } else if (input.action === "set-role") {
        if (target.role === input.role) return;
        if (target.role === "ADMIN" && target.active && (await otherActiveAdmins()) === 0) {
          throw new ApiError(409, "You can't demote the last active admin");
        }
        await tx.user.update({ where: { id: target.id }, data: { role: input.role } });
        await tx.session.deleteMany({ where: { userId: target.id } }); // permissions changed — sign in again
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "STAFF_ROLE_CHANGED", entityType: "User", entityId: target.id,
            detail: { name: target.name, email: target.email, from: target.role, to: input.role },
          }),
        });
      } else {
        await tx.user.update({ where: { id: target.id }, data: { passwordHash: passwordHash!, mustChangePassword: true } });
        await tx.session.deleteMany({ where: { userId: target.id } });
        await audit("STAFF_PASSWORD_RESET");
      }
    }, TX_OPTIONS);

    return ok(temporaryPassword ? { success: true, temporaryPassword } : { success: true });
  } catch (e) {
    return fail(e);
  }
}
