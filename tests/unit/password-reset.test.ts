import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Self-service "forgot password": generic answer, token rules, the link
// never stored in the outbox, and the reset revoking every session.
// Prisma, the email provider, the rate limiter and next/server's after() are mocked.
const db = vi.hoisted(() => {
  const d = {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), update: vi.fn() },
    passwordResetToken: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  d.$transaction.mockImplementation(async (fn: (tx: typeof d) => unknown) => fn(d));
  return d;
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));

const limiter = vi.hoisted(() => ({
  retryAfter: vi.fn<(key: string) => Promise<number>>(async () => 0),
  recordFailure: vi.fn<(key: string) => Promise<void>>(async () => {}),
  clearFailures: vi.fn<(key: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/lib/rate-limit", () => limiter);

const deferred = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => deferred.push(fn) }));

// Outbox store + provider: record what is stored vs. what is actually sent.
const outbox = vi.hoisted(() => ({ inserted: [] as { text: string }[], sent: [] as { text: string; to: string }[] }));
vi.mock("@/lib/email/outbox", async (orig) => {
  const real = await orig<typeof import("@/lib/email/outbox")>();
  return {
    ...real,
    createPrismaOutboxStore: () => ({
      insert: async (email: { text: string; subject: string; recipientEmail: string }) => {
        outbox.inserted.push(email);
        return { id: "n1" };
      },
      get: async () => {
        const e = outbox.inserted.at(-1) as { text: string; subject: string; recipientEmail: string };
        return { id: "n1", recipientEmail: e.recipientEmail, subject: e.subject, text: e.text, companyName: "Acme" };
      },
      claim: async () => true,
      markSent: async () => {},
      markSimulated: async () => {},
      markFailed: async () => {},
      findRetryable: async () => [],
    }),
  };
});
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({
    name: "resend",
    simulated: false,
    send: async (m: { text: string; to: string }) => {
      outbox.sent.push(m);
      return { id: "re_1" };
    },
  }),
}));

import { POST as forgot } from "@/app/api/auth/forgot-password/route";
import { POST as reset } from "@/app/api/auth/reset-password/route";
import {
  FORGOT_PASSWORD_RESPONSE, INVALID_RESET_LINK, PASSWORD_RESET_TTL_MS, REDACTED_RESET_LINK, hashResetToken, issuePasswordReset,
  resetPasswordWithToken,
} from "@/lib/password-reset";
import { ApiError } from "@/lib/api-helpers";

const json = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "198.51.100.4" }, body: JSON.stringify(body) });

const user = (over: Record<string, unknown> = {}) => ({
  id: "u1", name: "Nadia Rahman", email: "nadia@acme.test", active: true, organizationId: "org1", organization: { status: "ACTIVE" }, ...over,
});

async function statusOf(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  outbox.inserted.length = 0;
  outbox.sent.length = 0;
  limiter.retryAfter.mockResolvedValue(0);
  db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/auth/forgot-password", () => {
  it.each([
    ["existing active account", user()],
    ["unknown email", null],
    ["deactivated account", user({ active: false })],
    ["suspended company", user({ organization: { status: "SUSPENDED" } })],
  ])("%s → the same generic 200", async (_label, found) => {
    db.user.findUnique.mockResolvedValue(found);
    const res = await forgot(json("/api/auth/forgot-password", { email: "Nadia@Acme.test" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FORGOT_PASSWORD_RESPONSE);
    // the reset is created after the response, and only for a resettable account
    expect(deferred).toHaveLength(found && found.active && found.organization.status === "ACTIVE" ? 1 : 0);
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("looks the account up by the normalized email", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await forgot(json("/api/auth/forgot-password", { email: "  Nadia@Acme.TEST " }));
    expect(db.user.findUnique.mock.calls[0][0].where).toEqual({ email: "nadia@acme.test" });
  });

  it("counts every request per client and per mailbox", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await forgot(json("/api/auth/forgot-password", { email: "x@y.test" }));
    expect(limiter.recordFailure.mock.calls.map((c) => c[0])).toEqual(["forgot-ip:198.51.100.4", "forgot-email:x@y.test"]);
  });

  it("client over its limit → 429", async () => {
    limiter.retryAfter.mockImplementation(async (k: string) => (k.startsWith("forgot-ip:") ? 300 : 0));
    const res = await forgot(json("/api/auth/forgot-password", { email: "x@y.test" }));
    expect(res.status).toBe(429);
  });

  it("mailbox over its limit → same generic 200 but nothing is sent", async () => {
    db.user.findUnique.mockResolvedValue(user());
    limiter.retryAfter.mockImplementation(async (k: string) => (k.startsWith("forgot-email:") ? 300 : 0));
    const res = await forgot(json("/api/auth/forgot-password", { email: "nadia@acme.test" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FORGOT_PASSWORD_RESPONSE);
    expect(deferred).toHaveLength(0);
  });

  it("invalid email → 400 (says nothing about accounts)", async () => {
    const res = await forgot(json("/api/auth/forgot-password", { email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("the deferred work issues the token and sends the email", async () => {
    db.user.findUnique.mockResolvedValue(user());
    await forgot(json("/api/auth/forgot-password", { email: "nadia@acme.test" }));
    await deferred[0]();
    expect(db.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0].to).toBe("nadia@acme.test");
  });
});

describe("issuePasswordReset", () => {
  it("stores only the SHA-256 of a 32-byte token, expiring in 1 hour, voiding older unused links", async () => {
    const now = new Date("2026-10-29T10:00:00Z");
    await issuePasswordReset({ id: "u1", name: "Nadia", email: "nadia@acme.test", organizationId: "org1" }, "198.51.100.4", now);
    expect(db.passwordResetToken.deleteMany.mock.calls[0][0].where).toEqual({ OR: [{ userId: "u1", usedAt: null }, { expiresAt: { lt: now } }] });
    const data = db.passwordResetToken.create.mock.calls[0][0].data;
    expect(data.expiresAt.getTime() - now.getTime()).toBe(PASSWORD_RESET_TTL_MS);
    expect(data.ip).toBe("198.51.100.4");

    // the sent email carries the real link; its token hashes to the stored value
    const link = outbox.sent[0].text.match(/https?:\/\/\S+\/reset-password\?token=(\S+)/);
    expect(link).not.toBeNull();
    const token = decodeURIComponent(link![1]);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(data.tokenHash).toBe(hashResetToken(token));
    expect(data.tokenHash).not.toBe(token);
    expect(outbox.sent[0].text).toMatch(/ignore this email/i);

    // the outbox row (visible to company staff) never holds the link
    expect(outbox.inserted[0].text).toContain(REDACTED_RESET_LINK);
    expect(outbox.inserted[0].text).not.toContain(token);
  });
});

describe("resetPasswordWithToken / POST /api/auth/reset-password", () => {
  const TOKEN = "t".repeat(43);
  const row = (over: Record<string, unknown> = {}) => ({
    id: "rt1", userId: "u1", tokenHash: hashResetToken(TOKEN), usedAt: null, expiresAt: new Date(Date.now() + 600_000), ip: null, createdAt: new Date(),
    user: user(), ...over,
  });

  it("valid link: new hash, mustChangePassword cleared, token used, other links deleted, ALL sessions revoked, audited", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(row());
    const res = await reset(json("/api/auth/reset-password", { token: TOKEN, newPassword: "brand-new-pass" }));
    expect(res.status).toBe(200);
    expect(db.passwordResetToken.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: createHash("sha256").update(TOKEN).digest("hex") });
    expect(db.passwordResetToken.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "rt1", usedAt: null }, data: { usedAt: expect.any(Date) } });
    const upd = db.user.update.mock.calls[0][0];
    expect(upd.data.mustChangePassword).toBe(false);
    expect(upd.data.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", id: { not: "rt1" } } });
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "PASSWORD_RESET", entityId: "u1", organizationId: "org1" });
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain("brand-new-pass");
    expect(limiter.clearFailures).toHaveBeenCalledWith("email:nadia@acme.test");
  });

  it.each([
    ["unknown", null],
    ["used", row({ usedAt: new Date() })],
    ["expired", row({ expiresAt: new Date(Date.now() - 1000) })],
    ["deactivated user", row({ user: user({ active: false }) })],
    ["suspended company", row({ user: user({ organization: { status: "SUSPENDED" } }) })],
  ])("%s link → 400, nothing changes, failure counted", async (_label, found) => {
    db.passwordResetToken.findUnique.mockResolvedValue(found);
    const res = await reset(json("/api/auth/reset-password", { token: TOKEN, newPassword: "brand-new-pass" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(INVALID_RESET_LINK);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.session.deleteMany).not.toHaveBeenCalled();
    expect(limiter.recordFailure).toHaveBeenCalledWith("reset-ip:198.51.100.4");
  });

  it("two submissions of one link: the second loses the atomic claim", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(row());
    db.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await statusOf(resetPasswordWithToken(TOKEN, "brand-new-pass", "1.2.3.4"))).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("same password rules as change-password (min 8)", async () => {
    const res = await reset(json("/api/auth/reset-password", { token: TOKEN, newPassword: "short" }));
    expect(res.status).toBe(400);
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("throttled client → 429 before any lookup", async () => {
    limiter.retryAfter.mockResolvedValue(120);
    expect(await statusOf(resetPasswordWithToken(TOKEN, "brand-new-pass", "1.2.3.4"))).toBe(429);
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});
