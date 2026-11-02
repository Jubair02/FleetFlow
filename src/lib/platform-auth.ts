import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import type { PlatformAdmin, PlatformSession } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import {
  PLATFORM_IDLE_TIMEOUT_MS, PLATFORM_MFA_PENDING_TTL_MS, PLATFORM_SESSION_TTL_MS, isIdleExpired, needsTouch,
} from "@/lib/session-policy";

/** 401 message when a console session ended because it sat unused. */
export const PLATFORM_IDLE_MESSAGE = `Your platform session ended after ${PLATFORM_IDLE_TIMEOUT_MS / 60_000} minutes of inactivity — please sign in again.`;

// ─────────────────────────────────────────────────────────────
// Platform (super admin) authentication — fully separate from tenant
// auth: its own table (PlatformAdmin), sessions (PlatformSession) and
// cookie. A tenant session can never satisfy requirePlatformAdmin(),
// and nothing on the User model grants platform access.
// Platform admins are created only by scripts/create-super-admin.mjs.
// Sign-in is password + authenticator code (TOTP, src/lib/platform-mfa.ts);
// lifetimes and idle timeouts are in src/lib/session-policy.ts.
// ─────────────────────────────────────────────────────────────

export const PLATFORM_COOKIE = "ff_platform_session";

export type PlatformAdminSafe = Pick<PlatformAdmin, "id" | "name" | "email" | "mustChangePassword" | "lastLoginAt" | "createdAt">;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function toSafeAdmin(a: PlatformAdmin): PlatformAdminSafe {
  return { id: a.id, name: a.name, email: a.email, mustChangePassword: a.mustChangePassword, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt };
}

async function setPlatformCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(PLATFORM_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Start a platform session. Sign-in always starts one with `mfaPending`
 * (password accepted, authenticator code still due): it lives only
 * PLATFORM_MFA_PENDING_TTL_MS and only the two-factor endpoints accept it.
 * completePlatformMfa() turns it into a full session.
 */
export async function createPlatformSession(adminId: string, opts: { mfaPending?: boolean } = {}): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const mfaPending = opts.mfaPending ?? true;
  const expiresAt = new Date(now.getTime() + (mfaPending ? PLATFORM_MFA_PENDING_TTL_MS : PLATFORM_SESSION_TTL_MS));
  await db.platformSession.deleteMany({ where: { adminId, expiresAt: { lt: now } } });
  await db.platformSession.create({ data: { token: hashToken(token), adminId, expiresAt, mfaPending, lastSeenAt: now } });
  await setPlatformCookie(token, expiresAt);
}

/**
 * Second factor accepted: replace the pending session's token (a token seen
 * before 2FA never becomes a full session) and give it the normal lifetime.
 */
export async function completePlatformMfa(sessionId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLATFORM_SESSION_TTL_MS);
  await db.platformSession.update({
    where: { id: sessionId },
    data: { token: hashToken(token), mfaPending: false, expiresAt, lastSeenAt: now },
  });
  await setPlatformCookie(token, expiresAt);
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

export interface PlatformAuthOptions {
  /**
   * Accept a session whose authenticator code is still due. ONLY for the
   * two-factor endpoints (/api/platform/auth/mfa/*) and logout.
   */
  allowMfaPending?: boolean;
}

export type PlatformSessionResult =
  | { admin: PlatformAdmin; session: PlatformSession; ended?: undefined }
  | { admin: null; session: null; ended?: "idle" };

const NO_SESSION = { admin: null, session: null } as const;

/**
 * Resolve the platform session from the cookie: absolute expiry, idle
 * timeout (PLATFORM_IDLE_TIMEOUT_MS) and — unless allowMfaPending — a
 * completed second factor. Expired / idle sessions are deleted.
 */
export async function getPlatformSession(opts: PlatformAuthOptions = {}): Promise<PlatformSessionResult> {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) return NO_SESSION;
  const found = await db.platformSession.findUnique({ where: { token: hashToken(token) }, include: { admin: true } });
  if (!found) return NO_SESSION;
  const { admin, ...session } = found;
  const now = new Date();
  if (session.expiresAt < now) {
    await db.platformSession.delete({ where: { id: session.id } }).catch(() => {});
    return NO_SESSION;
  }
  // Pending sessions have their own short expiry; the idle rule is for full sessions.
  if (!session.mfaPending && isIdleExpired(session.lastSeenAt, now, PLATFORM_IDLE_TIMEOUT_MS)) {
    await db.platformSession.delete({ where: { id: session.id } }).catch(() => {});
    return { ...NO_SESSION, ended: "idle" };
  }
  if (!admin.active) return NO_SESSION;
  if (session.mfaPending && !opts.allowMfaPending) return NO_SESSION;
  if (!session.mfaPending && needsTouch(session.lastSeenAt, now)) {
    // Throttled activity stamp; a failed write must never fail the request.
    await db.platformSession.updateMany({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});
  }
  return { admin, session };
}

/** The signed-in super admin (two-factor completed), or null. */
export async function getPlatformAdmin(opts: PlatformAuthOptions = {}): Promise<PlatformAdmin | null> {
  return (await getPlatformSession(opts)).admin;
}

export interface RequirePlatformOptions extends PlatformAuthOptions {
  allowPasswordChangePending?: boolean;
}

/** requirePlatformAdmin(), also returning the session row (the two-factor endpoints need it). */
export async function requirePlatformSession(opts: RequirePlatformOptions = {}): Promise<{ admin: PlatformAdmin; session: PlatformSession }> {
  const { admin, session, ended } = await getPlatformSession(opts);
  if (!admin) {
    throw new ApiError(401, ended === "idle" ? PLATFORM_IDLE_MESSAGE : "Platform authentication required");
  }
  if (admin.mustChangePassword && !opts.allowPasswordChangePending) {
    throw new ApiError(403, "Change your temporary password before using the platform console");
  }
  return { admin, session };
}

/**
 * Server-side guard for every /api/platform route (except login).
 * A session still waiting for its authenticator code is NOT signed in
 * (unless allowMfaPending, used only by the two-factor endpoints).
 * By default an admin who still has to change their temporary password
 * may only reach the endpoints that let them do so.
 */
export async function requirePlatformAdmin(opts: RequirePlatformOptions = {}): Promise<PlatformAdmin> {
  return (await requirePlatformSession(opts)).admin;
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
