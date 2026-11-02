import QRCode from "qrcode";
import { z } from "zod";
import type { PlatformAdmin, PlatformSession } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { TX_OPTIONS } from "@/lib/delivery";
import { clearFailures, recordFailure, retryAfter } from "@/lib/rate-limit";
import { completePlatformMfa, platformAuditData } from "@/lib/platform-auth";
import {
  consumeBackupCode, formatSecretForDisplay, generateBackupCodes, generateTotpSecret, hashBackupCode,
  looksLikeBackupCode, otpauthUri, verifyTotp,
} from "@/lib/totp";

// ─────────────────────────────────────────────────────────────
// Super-admin two-factor sign-in (mandatory for every platform admin).
//
//   password OK ──► pending session ──► enrolled? ──no──► setup (QR) ─► confirm code ─► backup codes
//                                         │yes
//                                         └──► authenticator code or backup code
//   then: full session (token rotated), and the temporary-password step if due.
//
// Attempts are throttled per admin ("mfa:<id>", 5 failures / 15 min) and per
// client ("ip:<ip>", shared with sign-in). Secrets and codes are never logged.
// Recovery for a lost phone + lost backup codes: scripts/reset-super-admin-2fa.mjs.
// ─────────────────────────────────────────────────────────────

export const mfaCodeSchema = z.object({
  code: z.string("Enter the code from your authenticator app").trim().min(6, "Enter the 6-digit code").max(32, "That code is too long"),
});

export type MfaStage = "enroll" | "verify";

/** Which second-factor step a password-verified admin must complete. */
export function mfaStageFor(admin: Pick<PlatformAdmin, "totpEnabledAt" | "totpSecret">): MfaStage {
  return admin.totpEnabledAt && admin.totpSecret ? "verify" : "enroll";
}

export function mfaThrottleKeys(adminId: string, ip: string): [string, string] {
  return [`mfa:${adminId}`, `ip:${ip}`];
}

const INVALID_CODE = "That code isn't valid. Check your authenticator app and try again.";

async function assertNotThrottled(keys: string[]): Promise<void> {
  const wait = Math.max(...(await Promise.all(keys.map(retryAfter))));
  if (wait > 0) {
    throw new ApiError(429, `Too many incorrect codes. Try again in ${Math.ceil(wait / 60)} minute(s).`);
  }
}

async function failAttempt(admin: PlatformAdmin, ip: string, stage: string, method: "totp" | "backup-code"): Promise<never> {
  await Promise.all(mfaThrottleKeys(admin.id, ip).map((k) => recordFailure(k)));
  await db.platformAuditLog.create({
    data: platformAuditData({ actor: admin, action: "PLATFORM_MFA_FAILED", targetType: "PlatformAdmin", targetId: admin.id, detail: { stage, method }, ip }),
  });
  throw new ApiError(400, INVALID_CODE);
}

export interface MfaSetup {
  otpauthUri: string;
  /** PNG data URL of the otpauth URI. */
  qrDataUrl: string;
  /** Base32 secret grouped in fours, for typing into the app by hand. */
  manualKey: string;
}

/**
 * Start (or restart) enrolment for an admin without two-factor: store a fresh
 * secret, not active until a code from it is confirmed. Only while the
 * session is pending — an enrolled admin can never get a new secret here.
 */
export async function beginEnrollment(admin: PlatformAdmin, session: PlatformSession, ip: string): Promise<MfaSetup> {
  if (!session.mfaPending) throw new ApiError(409, "This session has already completed two-factor sign-in");
  if (admin.totpEnabledAt) throw new ApiError(409, "Two-factor sign-in is already set up for this account");
  const secret = generateTotpSecret();
  await db.$transaction(async (tx) => {
    await tx.platformAdmin.update({
      where: { id: admin.id },
      data: { totpSecret: secret, totpLastStep: null, totpBackupCodes: [] },
    });
    await tx.platformAuditLog.create({
      data: platformAuditData({ actor: admin, action: "PLATFORM_MFA_SETUP_STARTED", targetType: "PlatformAdmin", targetId: admin.id, ip }),
    });
  }, TX_OPTIONS);
  const uri = otpauthUri(secret, admin.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  return { otpauthUri: uri, qrDataUrl, manualKey: formatSecretForDisplay(secret) };
}

export interface MfaVerifyResult {
  admin: PlatformAdmin;
  method: "totp" | "backup-code";
  /** Only on first enrolment: the one-time backup codes, shown once. */
  backupCodes?: string[];
  /** Backup codes left after this sign-in. */
  backupCodesRemaining: number;
}

/**
 * Check the second factor for a pending session. On success the session
 * becomes a full one (new token) and the sign-in is audited.
 */
export async function verifySecondFactor(admin: PlatformAdmin, session: PlatformSession, rawCode: string, ip: string): Promise<MfaVerifyResult> {
  if (!session.mfaPending) throw new ApiError(409, "This session has already completed two-factor sign-in");
  const keys = mfaThrottleKeys(admin.id, ip);
  await assertNotThrottled(keys);
  const now = new Date();

  let result: MfaVerifyResult;
  if (!admin.totpEnabledAt) {
    // ── first enrolment: confirm a code from the new secret ──
    if (!admin.totpSecret) throw new ApiError(409, "Start the two-factor setup first");
    const step = verifyTotp(admin.totpSecret, rawCode, { now: now.getTime(), lastStep: admin.totpLastStep });
    if (step === null) return failAttempt(admin, ip, "enroll", "totp");
    const backupCodes = generateBackupCodes();
    const updated = await db.$transaction(async (tx) => {
      // Guarded on the same secret: a concurrent restart of the setup can't be confirmed with an old code.
      const res = await tx.platformAdmin.updateMany({
        where: { id: admin.id, totpEnabledAt: null, totpSecret: admin.totpSecret },
        data: { totpEnabledAt: now, totpLastStep: step, totpBackupCodes: backupCodes.map(hashBackupCode), lastLoginAt: now },
      });
      if (res.count !== 1) throw new ApiError(409, "Two-factor setup changed in another window — sign in again");
      await tx.platformAuditLog.create({
        data: platformAuditData({ actor: admin, action: "PLATFORM_MFA_ENROLLED", targetType: "PlatformAdmin", targetId: admin.id, ip }),
      });
      return tx.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
    }, TX_OPTIONS);
    result = { admin: updated, method: "totp", backupCodes, backupCodesRemaining: backupCodes.length };
  } else if (looksLikeBackupCode(rawCode)) {
    // ── one-time backup code ──
    const remaining = consumeBackupCode(admin.totpBackupCodes, rawCode);
    if (!remaining) return failAttempt(admin, ip, "verify", "backup-code");
    const updated = await db.$transaction(async (tx) => {
      // Compare-and-set on the whole list: two concurrent uses of one code can't both succeed.
      const res = await tx.platformAdmin.updateMany({
        where: { id: admin.id, totpBackupCodes: { equals: admin.totpBackupCodes } },
        data: { totpBackupCodes: remaining, lastLoginAt: now },
      });
      if (res.count !== 1) return null;
      await tx.platformAuditLog.create({
        data: platformAuditData({
          actor: admin, action: "PLATFORM_BACKUP_CODE_USED", targetType: "PlatformAdmin", targetId: admin.id,
          detail: { remaining: remaining.length }, ip,
        }),
      });
      return tx.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
    }, TX_OPTIONS);
    if (!updated) return failAttempt(admin, ip, "verify", "backup-code");
    result = { admin: updated, method: "backup-code", backupCodesRemaining: remaining.length };
  } else {
    // ── authenticator code, each step accepted once ──
    const step = verifyTotp(admin.totpSecret!, rawCode, { now: now.getTime(), lastStep: admin.totpLastStep });
    if (step === null) return failAttempt(admin, ip, "verify", "totp");
    const updated = await acceptStep(admin.id, step, { lastLoginAt: now });
    if (!updated) return failAttempt(admin, ip, "verify", "totp");
    result = { admin: updated, method: "totp", backupCodesRemaining: updated.totpBackupCodes.length };
  }

  await clearFailures(keys[0]); // the account key only — never reset the per-client counter
  await completePlatformMfa(session.id);
  await db.platformAuditLog.create({
    data: platformAuditData({ actor: admin, action: "PLATFORM_LOGIN", targetType: "PlatformAdmin", targetId: admin.id, detail: { method: result.method }, ip }),
  });
  return result;
}

/**
 * Record `step` as used, atomically: only succeeds when it is newer than the
 * last accepted step, so a code can't be replayed (even concurrently).
 */
async function acceptStep(adminId: string, step: number, extra: { lastLoginAt?: Date } = {}): Promise<PlatformAdmin | null> {
  const res = await db.platformAdmin.updateMany({
    where: { id: adminId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step, ...extra },
  });
  if (res.count !== 1) return null;
  return db.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
}

/**
 * Replace every backup code (the old ones stop working). Requires a current
 * authenticator code — a backup code can't be used to mint new ones.
 */
export async function regenerateBackupCodes(admin: PlatformAdmin, rawCode: string, ip: string): Promise<string[]> {
  if (!admin.totpEnabledAt || !admin.totpSecret) throw new ApiError(409, "Two-factor sign-in isn't set up for this account");
  const keys = mfaThrottleKeys(admin.id, ip);
  await assertNotThrottled(keys);
  const step = verifyTotp(admin.totpSecret, rawCode, { lastStep: admin.totpLastStep });
  if (step === null || !(await acceptStep(admin.id, step))) return failAttempt(admin, ip, "regenerate", "totp");
  await clearFailures(keys[0]);
  const codes = generateBackupCodes();
  await db.$transaction(async (tx) => {
    await tx.platformAdmin.update({ where: { id: admin.id }, data: { totpBackupCodes: codes.map(hashBackupCode) } });
    await tx.platformAuditLog.create({
      data: platformAuditData({
        actor: admin, action: "PLATFORM_BACKUP_CODES_REGENERATED", targetType: "PlatformAdmin", targetId: admin.id,
        detail: { count: codes.length }, ip,
      }),
    });
  }, TX_OPTIONS);
  return codes;
}

/** Safe two-factor summary for the console (never the secret or hashes). */
export function mfaStatus(admin: Pick<PlatformAdmin, "totpEnabledAt" | "totpBackupCodes">) {
  return {
    enabled: !!admin.totpEnabledAt,
    enabledAt: admin.totpEnabledAt ? admin.totpEnabledAt.toISOString() : null,
    backupCodesRemaining: admin.totpEnabledAt ? admin.totpBackupCodes.length : 0,
  };
}
