import { cookies } from "next/headers";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "@/lib/db";
import type { DriverProfile, Organization, User } from "@prisma/client";
import { COMPANY_SESSION_TTL_MS, companyIdleTimeoutMs, isIdleExpired, needsTouch } from "@/lib/session-policy";

export const SESSION_COOKIE = "ff_session";

/** Organization fields every session carries (status gates access; the rest drives subscription banners). */
export const SESSION_ORG_SELECT = {
  id: true, name: true, timezone: true, status: true, subscriptionStatus: true, trialEndsAt: true, paidUntil: true,
} as const;

export type SessionOrg = Pick<Organization, "id" | "name" | "timezone" | "status" | "subscriptionStatus" | "trialEndsAt" | "paidUntil">;

export type SessionUser = User & {
  driverProfile: DriverProfile | null;
  organization: SessionOrg;
};

// ── Password hashing (scrypt, no external deps) ──────────────
// Async scrypt so a login never blocks the event loop.

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)).toString("hex");
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Hash checked when the email is unknown, so response time doesn't reveal which accounts exist. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

// ── Sessions (DB-backed, revocable) ──────────────────────────
// Only a SHA-256 of the cookie token is stored, so a DB leak can't be replayed.

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COMPANY_SESSION_TTL_MS);
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: now } } });
  await db.session.create({ data: { token: hashToken(token), userId, expiresAt, lastSeenAt: now } });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token: hashToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Why there is no signed-in user: "idle" lets the 401 say the session timed out. */
export type SessionState = { user: SessionUser; ended?: undefined } | { user: null; ended?: "idle" };

/**
 * Resolve the company session from the cookie, enforcing the absolute expiry
 * and the role's idle timeout (src/lib/session-policy.ts). An expired or idle
 * session is deleted. lastSeenAt is refreshed at most once a minute.
 */
export async function getSessionState(): Promise<SessionState> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return { user: null };
  const session = await db.session.findUnique({
    where: { token: hashToken(token) },
    include: {
      user: {
        include: {
          driverProfile: true,
          organization: { select: SESSION_ORG_SELECT },
        },
      },
    },
  });
  if (!session) return { user: null };
  const now = new Date();
  if (session.expiresAt < now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return { user: null };
  }
  if (isIdleExpired(session.lastSeenAt, now, companyIdleTimeoutMs(session.user.role))) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return { user: null, ended: "idle" };
  }
  if (!session.user.active) return { user: null };
  // A suspended company's staff and drivers lose API access immediately (data is kept).
  if (session.user.organization.status !== "ACTIVE") return { user: null };
  if (needsTouch(session.lastSeenAt, now)) {
    // Throttled activity stamp; a failed write must never fail the request.
    await db.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});
  }
  return { user: session.user };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getSessionState()).user;
}
