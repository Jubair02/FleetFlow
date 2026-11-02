import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdmin, PlatformSession } from "@prisma/client";

// Super-admin two-factor: enrolment, verification, replay & backup codes,
// throttling, and the password step opening only a pending session.
// Prisma, cookies and the rate limiter are mocked.
const db = vi.hoisted(() => {
  const d = {
    $transaction: vi.fn(),
    platformAdmin: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    platformSession: { create: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    platformAuditLog: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  d.$transaction.mockImplementation(async (fn: (tx: typeof d) => unknown) => fn(d));
  return d;
});
vi.mock("@/lib/db", () => ({ db }));

const cookieSet = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: cookieSet, delete: vi.fn() }) }));

const limiter = vi.hoisted(() => ({
  retryAfter: vi.fn<(key: string) => Promise<number>>(async () => 0),
  recordFailure: vi.fn<(key: string) => Promise<void>>(async () => {}),
  clearFailures: vi.fn<(key: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/lib/rate-limit", () => limiter);

import { ApiError } from "@/lib/api-helpers";
import { hashPassword } from "@/lib/auth";
import { authenticate } from "@/lib/login-service";
import { beginEnrollment, mfaStageFor, regenerateBackupCodes, verifySecondFactor } from "@/lib/platform-mfa";
import { generateBackupCodes, generateTotpSecret, hashBackupCode, totpCode, totpStep } from "@/lib/totp";

const SECRET = generateTotpSecret();
const IP = "203.0.113.9";

function admin(over: Partial<PlatformAdmin> = {}): PlatformAdmin {
  return {
    id: "pa1", name: "Root", email: "root@fleetflow.test", passwordHash: "salt:hash", active: true, mustChangePassword: false,
    lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(),
    totpSecret: SECRET, totpEnabledAt: new Date("2026-10-01"), totpLastStep: null, totpBackupCodes: [], ...over,
  };
}
function session(over: Partial<PlatformSession> = {}): PlatformSession {
  return { id: "ps1", token: "h", adminId: "pa1", expiresAt: new Date(Date.now() + 600_000), createdAt: new Date(), mfaPending: true, lastSeenAt: new Date(), ...over };
}

async function statusOf(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}
const auditActions = () => db.platformAuditLog.create.mock.calls.map((c) => c[0].data.action);
const auditDump = () => JSON.stringify(db.platformAuditLog.create.mock.calls);

beforeEach(() => {
  vi.clearAllMocks();
  limiter.retryAfter.mockResolvedValue(0);
  db.platformAdmin.updateMany.mockResolvedValue({ count: 1 });
  db.platformAdmin.findUniqueOrThrow.mockImplementation(async () => admin());
  db.platformSession.update.mockResolvedValue({});
});

describe("password step", () => {
  it("a correct staff password opens only a pending session and says which 2FA step is due", async () => {
    const passwordHash = await hashPassword("correct horse battery");
    db.platformAdmin.findUnique.mockResolvedValue(admin({ passwordHash, totpEnabledAt: null, totpSecret: null }));
    db.user.findUnique.mockResolvedValue(null);
    const res = await authenticate("root@fleetflow.test", "correct horse battery", IP);
    expect(res).toMatchObject({ kind: "platform", mfa: "enroll" });
    const created = db.platformSession.create.mock.calls[0][0].data;
    expect(created.mfaPending).toBe(true);
    expect(created.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect(auditActions()).toEqual(["PLATFORM_LOGIN_PASSWORD_OK"]);
    expect(db.platformAdmin.update).not.toHaveBeenCalled(); // lastLoginAt waits for the second factor
  });

  it("an enrolled admin gets the verify step", () => {
    expect(mfaStageFor(admin())).toBe("verify");
    expect(mfaStageFor(admin({ totpEnabledAt: null }))).toBe("enroll");
  });
});

describe("enrolment", () => {
  it("setup stores a fresh secret and returns a QR data URL + manual key", async () => {
    const res = await beginEnrollment(admin({ totpEnabledAt: null, totpSecret: null }), session(), IP);
    expect(res.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.otpauthUri).toMatch(/^otpauth:\/\/totp\/FleetFlow:/);
    const stored = db.platformAdmin.update.mock.calls[0][0].data.totpSecret as string;
    expect(res.manualKey.replace(/ /g, "")).toBe(stored);
    expect(auditDump()).not.toContain(stored); // never logged
  });

  it("setup is refused for an enrolled admin or a completed session", async () => {
    expect(await statusOf(beginEnrollment(admin(), session(), IP))).toBe(409);
    expect(await statusOf(beginEnrollment(admin({ totpEnabledAt: null }), session({ mfaPending: false }), IP))).toBe(409);
    expect(db.platformAdmin.update).not.toHaveBeenCalled();
  });

  it("confirming a code enables 2FA, returns 10 backup codes once and stores only their hashes", async () => {
    const pending = admin({ totpEnabledAt: null });
    const res = await verifySecondFactor(pending, session(), totpCode(SECRET), IP);
    expect(res.backupCodes).toHaveLength(10);
    const data = db.platformAdmin.updateMany.mock.calls[0][0].data;
    expect(data.totpEnabledAt).toBeInstanceOf(Date);
    expect(data.totpBackupCodes).toEqual(res.backupCodes!.map(hashBackupCode));
    expect(auditActions()).toEqual(["PLATFORM_MFA_ENROLLED", "PLATFORM_LOGIN"]);
    for (const c of res.backupCodes!) expect(auditDump()).not.toContain(c);
    // the pending session becomes a full one with a NEW token
    const upd = db.platformSession.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "ps1" });
    expect(upd.data.mfaPending).toBe(false);
    expect(upd.data.expiresAt.getTime() - Date.now()).toBeGreaterThan(11 * 3600_000);
    const cookieToken = cookieSet.mock.calls[0][1];
    expect(upd.data.token).toBe(createHash("sha256").update(cookieToken).digest("hex"));
  });

  it("before setup there's nothing to confirm", async () => {
    expect(await statusOf(verifySecondFactor(admin({ totpEnabledAt: null, totpSecret: null }), session(), "123456", IP))).toBe(409);
  });
});

describe("verification", () => {
  it("a valid code completes sign-in and clears only the per-admin failure counter", async () => {
    const res = await verifySecondFactor(admin(), session(), totpCode(SECRET), IP);
    expect(res.method).toBe("totp");
    expect(res.backupCodes).toBeUndefined();
    const where = db.platformAdmin.updateMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ totpLastStep: null }, { totpLastStep: { lt: expect.any(Number) } }]);
    expect(limiter.clearFailures).toHaveBeenCalledWith("mfa:pa1");
    expect(limiter.clearFailures).not.toHaveBeenCalledWith(`ip:${IP}`);
    expect(db.platformSession.update).toHaveBeenCalled();
    expect(auditActions()).toEqual(["PLATFORM_LOGIN"]);
  });

  it("a wrong code → 400, counts against admin and client, audited without the code, session stays pending", async () => {
    expect(await statusOf(verifySecondFactor(admin(), session(), "000000", IP))).toBe(400);
    expect(limiter.recordFailure.mock.calls.map((c) => c[0]).sort()).toEqual([`ip:${IP}`, "mfa:pa1"]);
    expect(auditActions()).toEqual(["PLATFORM_MFA_FAILED"]);
    expect(auditDump()).not.toContain("000000");
    expect(db.platformSession.update).not.toHaveBeenCalled();
  });

  it("replay: a code whose step was already used is refused", async () => {
    const code = totpCode(SECRET);
    const used = admin({ totpLastStep: totpStep() + 1 });
    expect(await statusOf(verifySecondFactor(used, session(), code, IP))).toBe(400);
    // concurrent replay: the compare-and-set update finds nothing to change
    db.platformAdmin.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await statusOf(verifySecondFactor(admin(), session(), code, IP))).toBe(400);
    expect(db.platformSession.update).not.toHaveBeenCalled();
  });

  it("locked after too many failures → 429 before any check", async () => {
    limiter.retryAfter.mockImplementation(async (k: string) => (k === "mfa:pa1" ? 600 : 0));
    expect(await statusOf(verifySecondFactor(admin(), session(), totpCode(SECRET), IP))).toBe(429);
    expect(db.platformSession.update).not.toHaveBeenCalled();
  });

  it("an already completed session can't be 'verified' again", async () => {
    expect(await statusOf(verifySecondFactor(admin(), session({ mfaPending: false }), totpCode(SECRET), IP))).toBe(409);
  });
});

describe("backup codes", () => {
  it("a backup code signs in once and is removed (compare-and-set on the list)", async () => {
    const codes = generateBackupCodes();
    const hashes = codes.map(hashBackupCode);
    const res = await verifySecondFactor(admin({ totpBackupCodes: hashes }), session(), codes[0].toUpperCase(), IP);
    expect(res.method).toBe("backup-code");
    const call = db.platformAdmin.updateMany.mock.calls[0][0];
    expect(call.where.totpBackupCodes).toEqual({ equals: hashes });
    expect(call.data.totpBackupCodes).toEqual(hashes.slice(1));
    expect(auditActions()).toEqual(["PLATFORM_BACKUP_CODE_USED", "PLATFORM_LOGIN"]);
    expect(auditDump()).not.toContain(codes[0]);
  });

  it("an unknown or already-used backup code fails", async () => {
    const codes = generateBackupCodes();
    const hashes = codes.slice(1).map(hashBackupCode); // codes[0] already used
    expect(await statusOf(verifySecondFactor(admin({ totpBackupCodes: hashes }), session(), codes[0], IP))).toBe(400);
    expect(db.platformAdmin.updateMany).not.toHaveBeenCalled();
  });

  it("two concurrent uses of one code: the loser fails", async () => {
    const codes = generateBackupCodes();
    db.platformAdmin.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await statusOf(verifySecondFactor(admin({ totpBackupCodes: codes.map(hashBackupCode) }), session(), codes[2], IP))).toBe(400);
    expect(db.platformSession.update).not.toHaveBeenCalled();
  });

  it("regenerating requires a current authenticator code (not a backup code) and replaces every hash", async () => {
    const old = generateBackupCodes();
    const a = admin({ totpBackupCodes: old.map(hashBackupCode) });
    expect(await statusOf(regenerateBackupCodes(a, old[0], IP))).toBe(400);
    expect(auditActions()).toEqual(["PLATFORM_MFA_FAILED"]);

    vi.clearAllMocks();
    db.platformAdmin.updateMany.mockResolvedValue({ count: 1 });
    const fresh = await regenerateBackupCodes(a, totpCode(SECRET), IP);
    expect(fresh).toHaveLength(10);
    expect(db.platformAdmin.update.mock.calls[0][0].data.totpBackupCodes).toEqual(fresh.map(hashBackupCode));
    expect(auditActions()).toEqual(["PLATFORM_BACKUP_CODES_REGENERATED"]);
    for (const c of fresh) expect(auditDump()).not.toContain(c);
  });

  it("regenerating is refused when 2FA isn't set up", async () => {
    expect(await statusOf(regenerateBackupCodes(admin({ totpEnabledAt: null, totpSecret: null }), "123456", IP))).toBe(409);
  });
});
