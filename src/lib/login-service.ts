import type { PlatformAdmin } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { createSession, getDummyHash, verifyPassword } from "@/lib/auth";
import { clearFailures, recordFailure, retryAfter } from "@/lib/rate-limit";
import { createPlatformSession, platformAuditData } from "@/lib/platform-auth";

// ─────────────────────────────────────────────────────────────
// The one sign-in implementation for every kind of account.
//
// Company admins, dispatchers and drivers are User rows (tenant-scoped);
// FleetFlow staff are PlatformAdmin rows (created only by
// scripts/create-super-admin.mjs). Both use the same form and endpoint;
// where the user lands is decided HERE, on the server, from which account
// the verified credentials belong to — never from anything the client sends.
//
// If one email exists in both tables, the platform account wins only when
// the password matches the platform account; otherwise the company account
// is used. Staff should use a separate email for any company account.
// ─────────────────────────────────────────────────────────────

const dto = { user: { include: { driverProfile: true, organization: { select: { id: true, name: true, status: true } } } } };

type TenantUser = NonNullable<Awaited<ReturnType<typeof findTenantUser>>>;

function findTenantUser(email: string) {
  return db.user.findUnique({ where: { email }, ...dto.user });
}

export type LoginResult =
  | { kind: "platform"; admin: PlatformAdmin; redirectTo: "/platform" }
  | { kind: "tenant"; user: TenantUser; redirectTo: "/" };

export interface LoginOptions {
  /** "platform" restricts sign-in to staff accounts (legacy /api/platform/auth/login). */
  scope?: "any" | "platform";
}

/**
 * Verify credentials, create the right session and return where to go.
 * Throws ApiError 401 (bad credentials, generic), 403 (suspended company /
 * deactivated account) or 429 (throttled).
 */
export async function authenticate(rawEmail: string, password: string, ip: string, opts: LoginOptions = {}): Promise<LoginResult> {
  const email = rawEmail.toLowerCase().trim();
  const scope = opts.scope ?? "any";

  // Throttle per account and per client so neither guessing nor CPU flooding scales.
  const keys = [`email:${email}`, `ip:${ip}`];
  const wait = Math.max(...keys.map(retryAfter));
  if (wait > 0) {
    throw new ApiError(429, `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
  }

  const [admin, user] = await Promise.all([
    db.platformAdmin.findUnique({ where: { email } }),
    scope === "any" ? findTenantUser(email) : Promise.resolve(null),
  ]);

  // Always run the same number of scrypt checks so response time doesn't
  // reveal which (if any) accounts exist for this email.
  const dummy = await getDummyHash();
  const [adminOk, userOk] = await Promise.all([
    verifyPassword(password, admin?.passwordHash ?? dummy),
    scope === "any" ? verifyPassword(password, user?.passwordHash ?? dummy) : Promise.resolve(false),
  ]);

  if (admin && adminOk && admin.active) {
    clearFailures(keys[0]); // only the account key — a valid login must not reset the per-client counter
    const updated = await db.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await createPlatformSession(admin.id);
    await db.platformAuditLog.create({
      data: platformAuditData({ actor: admin, action: "PLATFORM_LOGIN", targetType: "PlatformAdmin", targetId: admin.id, ip }),
    });
    return { kind: "platform", admin: updated, redirectTo: "/platform" };
  }

  if (user && userOk) {
    clearFailures(keys[0]);
    if (user.organization.status !== "ACTIVE") {
      throw new ApiError(403, "Your company's FleetFlow account is suspended. Contact FleetFlow support.");
    }
    if (!user.active) {
      throw new ApiError(403, "This account has been deactivated. Contact your dispatcher.");
    }
    await createSession(user.id);
    const updated = await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() }, ...dto.user });
    return { kind: "tenant", user: updated, redirectTo: "/" };
  }

  keys.forEach(recordFailure);
  if (admin) {
    await db.platformAuditLog.create({
      data: platformAuditData({
        actor: null, action: "PLATFORM_LOGIN_FAILED", targetType: "PlatformAdmin", targetId: admin.id,
        detail: { reason: !adminOk ? "bad-credentials" : "inactive" }, ip,
      }),
    });
  }
  throw new ApiError(401, "Invalid email or password");
}
