import { cookies } from "next/headers";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "@/lib/db";
import type { DriverProfile, Organization, User } from "@prisma/client";

export const SESSION_COOKIE = "ff_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type SessionUser = User & {
  driverProfile: DriverProfile | null;
  organization: Pick<Organization, "id" | "name" | "status">;
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
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  await db.session.create({ data: { token: hashToken(token), userId, expiresAt } });
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

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token: hashToken(token) },
    include: {
      user: {
        include: {
          driverProfile: true,
          organization: { select: { id: true, name: true, status: true } },
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.user.active) return null;
  // A suspended company's staff and drivers lose API access immediately (data is kept).
  if (session.user.organization.status !== "ACTIVE") return null;
  return session.user;
}
