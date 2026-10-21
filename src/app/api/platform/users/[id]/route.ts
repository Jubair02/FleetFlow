import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp, generateTempPassword } from "@/lib/account";
import { lockDriver, table, TX_OPTIONS } from "@/lib/delivery";
import { assertPlanLimit } from "@/lib/plans";
import { platformAuditData, requirePlatformAdmin } from "@/lib/platform-auth";
import { checkDeactivate, parseBody, resourceForRole, supportAuditData, userActionSchema } from "@/lib/platform-service";

type Params = { params: Promise<{ id: string }> };

const AUDIT_ACTIONS = {
  deactivate: "USER_DEACTIVATED",
  activate: "USER_ACTIVATED",
  "reset-password": "USER_PASSWORD_RESET",
  "revoke-sessions": "USER_SESSIONS_REVOKED",
} as const;

// PATCH /api/platform/users/[id] {action} → { success, temporaryPassword? }
// There is deliberately no action that changes a role or grants platform access.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await params;
    const { action } = parseBody(userActionSchema, await readJson<unknown>(req));

    // Hash outside the transaction so the connection isn't held during scrypt.
    const temporaryPassword = action === "reset-password" ? generateTempPassword() : null;
    const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

    await db.$transaction(async (tx) => {
      const found = await tx.user.findUnique({ where: { id }, select: { organizationId: true } });
      if (!found) throw new ApiError(404, "User not found");
      // Same lock order as tenant routes: organization (admin counts / plan limits), then driver (dispatch).
      await tx.$queryRaw`SELECT id FROM ${table("Organization")} WHERE id = ${found.organizationId} FOR UPDATE`;
      await lockDriver(tx, id);
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, name: true, email: true, role: true, active: true, organizationId: true, organization: { select: { status: true } } },
      });
      if (!target) throw new ApiError(404, "User not found");
      const orgId = target.organizationId;

      let changed = true;
      let detail: Record<string, unknown> = { name: target.name, email: target.email, role: target.role };

      if (action === "deactivate") {
        const [activeJobs, otherActiveAdmins] = await Promise.all([
          tx.assignment.count({ where: { driverId: target.id, active: true } }),
          tx.user.count({ where: { organizationId: orgId, role: "ADMIN", active: true, id: { not: target.id } } }),
        ]);
        changed = checkDeactivate({ role: target.role, active: target.active, activeJobs, otherActiveAdmins, orgStatus: target.organization.status });
        if (changed) {
          await tx.user.update({ where: { id: target.id }, data: { active: false } });
          await tx.session.deleteMany({ where: { userId: target.id } }); // sign out immediately
        }
      } else if (action === "activate") {
        changed = !target.active;
        if (changed) {
          await assertPlanLimit(tx, orgId, resourceForRole(target.role));
          await tx.user.update({ where: { id: target.id }, data: { active: true } });
        }
      } else if (action === "reset-password") {
        await tx.user.update({ where: { id: target.id }, data: { passwordHash: passwordHash!, mustChangePassword: true } });
        await tx.session.deleteMany({ where: { userId: target.id } });
      } else {
        const { count } = await tx.session.deleteMany({ where: { userId: target.id } });
        detail = { ...detail, sessionsRevoked: count };
      }
      if (!changed) return; // already in the requested state — nothing to record

      const auditAction = AUDIT_ACTIONS[action];
      await tx.platformAuditLog.create({
        data: platformAuditData({
          actor: admin, action: auditAction, targetType: "User", targetId: target.id, organizationId: orgId, detail, ip: clientIp(req),
        }),
      });
      await tx.auditLog.create({
        data: supportAuditData({ organizationId: orgId, action: auditAction, entityType: "User", entityId: target.id, detail }),
      });
    }, TX_OPTIONS);

    return ok(temporaryPassword ? { success: true, temporaryPassword } : { success: true });
  } catch (e) {
    return fail(e);
  }
}
