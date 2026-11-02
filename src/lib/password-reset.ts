import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { hashPassword } from "@/lib/auth";
import { TX_OPTIONS } from "@/lib/delivery";
import { getEmailProvider } from "@/lib/email";
import { createPrismaOutboxStore, queueAndSend, type OutboxStore } from "@/lib/email/outbox";
import { passwordResetEmail, passwordResetUrl } from "@/lib/email/templates";
import { auditData } from "@/lib/notify";
import { clearFailures, recordFailure, retryAfter } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// Self-service "forgot password" for company users (admins, dispatchers,
// drivers). Super admins are never reset this way — they use
// scripts/create-super-admin.mjs --reset-password.
//
// • The emailed token is 32 random bytes; only its SHA-256 is stored.
// • Single use, 1 hour, and a new request voids the user's older links.
// • The link itself is never stored in the outbox row (company staff can
//   read their org's outbox) — see sendResetEmail().
// • A successful reset signs the user out everywhere.
// ─────────────────────────────────────────────────────────────

/** How long an emailed reset link works. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const TOKEN_BYTES = 32;

/** Answer to every forgot-password request, so it can't be used to find accounts. */
export const FORGOT_PASSWORD_RESPONSE = {
  success: true,
  message: "If an account exists for that email, we've sent a link to reset the password. Check your inbox (and spam folder).",
} as const;

export const INVALID_RESET_LINK = "This reset link is invalid or has expired. Request a new one from the sign-in page.";

/** Stored in the outbox instead of the link; only the delivered email carries the real one. */
export const REDACTED_RESET_LINK = "[link included only in the delivered email — request a new one from the sign-in page]";

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export interface ResettableUser {
  id: string;
  name: string;
  email: string;
  organizationId: string;
}

/** The account a reset may be sent to: exists, active, and its company is ACTIVE. */
export async function findResettableUser(email: string): Promise<ResettableUser | null> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true, active: true, organizationId: true, organization: { select: { status: true } } },
  });
  if (!user || !user.active || user.organization.status !== "ACTIVE") return null;
  return { id: user.id, name: user.name, email: user.email, organizationId: user.organizationId };
}

const outbox = createPrismaOutboxStore(db);

/**
 * Queue + send through the normal outbox, but the row only ever holds the
 * redacted text: the real link is swapped in when this one send reads the
 * row. A later outbox retry sends the redacted text (the link may have
 * expired by then anyway), and no staff member can lift a link from the outbox.
 */
async function sendResetEmail(user: ResettableUser, token: string): Promise<void> {
  const minutes = PASSWORD_RESET_TTL_MS / 60_000;
  const stored = passwordResetEmail({ name: user.name, resetUrl: REDACTED_RESET_LINK, expiresInMinutes: minutes });
  const real = passwordResetEmail({ name: user.name, resetUrl: passwordResetUrl(token), expiresInMinutes: minutes });
  const store: OutboxStore = {
    ...outbox,
    async get(id) {
      const row = await outbox.get(id);
      return row ? { ...row, text: real.text } : null;
    },
  };
  await queueAndSend(store, getEmailProvider(), {
    organizationId: user.organizationId,
    userId: user.id,
    type: "PASSWORD_RESET",
    recipientEmail: user.email,
    subject: stored.subject,
    text: stored.text,
  });
}

/** Create a fresh reset link (voiding older unused ones) and email it. */
export async function issuePasswordReset(user: ResettableUser, ip: string | null, now: Date = new Date()): Promise<void> {
  const { token, tokenHash } = createResetToken();
  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: { OR: [{ userId: user.id, usedAt: null }, { expiresAt: { lt: now } }] },
    });
    await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS), ip },
    });
  }, TX_OPTIONS);
  await sendResetEmail(user, token);
}

/** Whether a link can still be used (the reset page shows "expired" up front). Doesn't consume it. */
export async function isResetTokenUsable(token: string, now: Date = new Date()): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { usedAt: true, expiresAt: true, user: { select: { active: true, organization: { select: { status: true } } } } },
  });
  return !!row && !row.usedAt && row.expiresAt > now && row.user.active && row.user.organization.status === "ACTIVE";
}

/**
 * Set a new password from an emailed link: marks the token used, deletes the
 * user's other links, clears mustChangePassword, signs out every session and
 * audits PASSWORD_RESET. The user then signs in normally.
 */
export async function resetPasswordWithToken(token: string, newPassword: string, ip: string, now: Date = new Date()): Promise<void> {
  // 256-bit tokens can't be guessed, but don't let a client hammer the endpoint either.
  const ipKey = `reset-ip:${ip}`;
  const wait = await retryAfter(ipKey);
  if (wait > 0) throw new ApiError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);

  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: { select: { id: true, name: true, email: true, active: true, organizationId: true, organization: { select: { status: true } } } } },
  });
  if (!row || row.usedAt || row.expiresAt <= now || !row.user.active || row.user.organization.status !== "ACTIVE") {
    await recordFailure(ipKey);
    throw new ApiError(400, INVALID_RESET_LINK);
  }
  const user = row.user;
  const passwordHash = await hashPassword(newPassword);

  await db.$transaction(async (tx) => {
    // Claim the token atomically: two submissions of one link can't both win.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new ApiError(400, INVALID_RESET_LINK);
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, id: { not: row.id } } });
    await tx.session.deleteMany({ where: { userId: user.id } }); // signed out everywhere
    await tx.auditLog.create({
      data: auditData({
        organizationId: user.organizationId, actorId: user.id, actorName: user.name,
        action: "PASSWORD_RESET", entityType: "User", entityId: user.id,
        detail: { method: "email-link" },
      }),
    });
  }, TX_OPTIONS);

  // Proven control of the mailbox: lift a sign-in lockout on this account.
  await clearFailures(`email:${user.email}`);
}
