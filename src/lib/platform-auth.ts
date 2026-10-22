import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import type { PlatformAdmin } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";

// ─────────────────────────────────────────────────────────────
// Platform (super admin) authentication — fully separate from tenant
// auth: its own table (PlatformAdmin), sessions (PlatformSession) and
// cookie. A tenant session can never satisfy requirePlatformAdmin(),
// and nothing on the User model grants platform access.
// Platform admins are created only by scripts/create-super-admin.mjs.
// ─────────────────────────────────────────────────────────────

export const PLATFORM_COOKIE = "ff_platform_session";
const PLATFORM_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — shorter than tenant sessions

export type PlatformAdminSafe = Pick<PlatformAdmin, "id" | "name" | "email" | "mustChangePassword" | "lastLoginAt" | "createdAt">;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function toSafeAdmin(a: PlatformAdmin): PlatformAdminSafe {
  return { id: a.id, name: a.name, email: a.email, mustChangePassword: a.mustChangePassword, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt };
}

export async function createPlatformSession(adminId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PLATFORM_SESSION_TTL_MS);
  await db.platformSession.deleteMany({ where: { adminId, expiresAt: { lt: new Date() } } });
  await db.platformSession.create({ data: { token: hashToken(token), adminId, expiresAt } });
  const store = await cookies();
  store.set(PLATFORM_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyPlatformSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(PLATFORM_COOKIE)?.value;
  if (token) await db.platformSession.deleteMany({ where: { token: hashToken(token) } });
  store.delete(PLATFORM_COOKIE);
}

/** Hash of the current platform cookie (to keep it when revoking other sessions). */
export async function currentPlatformTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) return null;
  const session = await db.platformSession.findUnique({ where: { token: hashToken(token) }, include: { admin: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.platformSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.admin.active) return null;
  return session.admin;
}

/**
 * Server-side guard for every /api/platform route (except login).
 * By default an admin who still has to change their temporary password
 * may only reach the endpoints that let them do so.
 */
export async function requirePlatformAdmin(opts: { allowPasswordChangePending?: boolean } = {}): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) throw new ApiError(401, "Platform authentication required");
  if (admin.mustChangePassword && !opts.allowPasswordChangePending) {
    throw new ApiError(403, "Change your temporary password before using the platform console");
  }
  return admin;
}

interface PlatformAuditInput {
  actor: Pick<PlatformAdmin, "id" | "name"> | null;
  action: string;
  targetType: "Organization" | "User" | "PlatformAdmin" | "Plan";
  targetId?: string | null;
  organizationId?: string | null;
  /** Safe metadata only — never passwords, hashes or tokens. */
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

const SECRET_KEYS = /pass|hash|token|secret|key/i;

/** Drop anything that looks like a credential before it reaches the log. */
export function sanitizeDetail(detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail) return null;
  const clean = Object.fromEntries(Object.entries(detail).filter(([k]) => !SECRET_KEYS.test(k)));
  return JSON.stringify(clean);
}

/** Append-only platform audit row (call inside the mutation's transaction when possible). */
export function platformAuditData(input: PlatformAuditInput) {
  return {
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    organizationId: input.organizationId ?? null,
    detail: sanitizeDetail(input.detail),
    ip: input.ip ?? null,
  };
}
