import { createHash } from "crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import type { Prisma, DriverProfile, Organization, User } from "@prisma/client";

export { generateTempPassword } from "@/lib/temp-password";

// ─────────────────────────────────────────────────────────────
// Account helpers shared by the auth, staff and driver routes.
// ─────────────────────────────────────────────────────────────

type UserWithOrg = User & {
  driverProfile: DriverProfile | null;
  organization: Pick<Organization, "id" | "name">;
};

/** The session payload returned by login, signup and /me (see SessionUser in types.ts). */
export function sessionUserDto(user: UserWithOrg) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    driverProfile: user.driverProfile,
    mustChangePassword: user.mustChangePassword,
  };
}

/** SHA-256 of the current request's session cookie (as stored in Session.token), if any. */
export async function currentSessionTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? createHash("sha256").update(token).digest("hex") : null;
}

/** Sign a user out everywhere except (optionally) the session making this request. */
export async function deleteOtherSessions(tx: Prisma.TransactionClient, userId: string, keepTokenHash: string | null) {
  await tx.session.deleteMany({
    where: { userId, ...(keepTokenHash ? { token: { not: keepTokenHash } } : {}) },
  });
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
