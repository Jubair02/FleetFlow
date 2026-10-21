import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DB and no request context: mock Prisma and the Next.js cookie store.
const db = vi.hoisted(() => ({
  platformSession: { findUnique: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { ApiError } from "@/lib/api-helpers";
import { PLATFORM_COOKIE, platformAuditData, requirePlatformAdmin, sanitizeDetail } from "@/lib/platform-auth";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const future = () => new Date(Date.now() + 60_000);
const admin = (over: Record<string, unknown> = {}) => ({
  id: "pa1", name: "Root", email: "root@fleetflow.test", passwordHash: "salt:hash",
  active: true, mustChangePassword: false, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(), ...over,
});

async function status(p: Promise<unknown>): Promise<number | "ok"> {
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
  jar.clear();
});

describe("sanitizeDetail", () => {
  it("returns null for empty input", () => {
    expect(sanitizeDetail(null)).toBeNull();
    expect(sanitizeDetail(undefined)).toBeNull();
  });

  it("drops credential-looking keys and keeps safe metadata", () => {
    const out = JSON.parse(
      sanitizeDetail({
        from: "starter", to: "growth", reason: "unpaid",
        password: "x", temporaryPassword: "y", passwordHash: "z", token: "t", sessionToken: "s", apiKey: "k", secret: "q",
      })!
    );
    expect(out).toEqual({ from: "starter", to: "growth", reason: "unpaid" });
  });

  it("platformAuditData never carries a temp password", () => {
    const row = platformAuditData({
      actor: { id: "pa1", name: "Root" }, action: "USER_PASSWORD_RESET", targetType: "User", targetId: "u1",
      detail: { email: "a@b.c", temporaryPassword: "Abc123xyz" }, ip: "1.2.3.4",
    });
    expect(row.detail).not.toContain("Abc123xyz");
    expect(row).toMatchObject({ actorId: "pa1", actorName: "Root", organizationId: null, ip: "1.2.3.4" });
  });
});

describe("requirePlatformAdmin", () => {
  it("no cookie → 401 without touching the DB", async () => {
    expect(await status(requirePlatformAdmin())).toBe(401);
    expect(db.platformSession.findUnique).not.toHaveBeenCalled();
  });

  it("a tenant ff_session cookie alone → 401", async () => {
    jar.set("ff_session", "tenant-token");
    db.platformSession.findUnique.mockResolvedValue({ id: "s", expiresAt: future(), admin: admin() });
    expect(await status(requirePlatformAdmin())).toBe(401);
    expect(db.platformSession.findUnique).not.toHaveBeenCalled();
  });

  it("unknown platform token → 401; looks up only the SHA-256 of the cookie", async () => {
    jar.set(PLATFORM_COOKIE, "abc");
    db.platformSession.findUnique.mockResolvedValue(null);
    expect(await status(requirePlatformAdmin())).toBe(401);
    expect(db.platformSession.findUnique.mock.calls[0][0].where).toEqual({ token: sha("abc") });
  });

  it("expired session → 401 and the session is removed", async () => {
    jar.set(PLATFORM_COOKIE, "abc");
    db.platformSession.findUnique.mockResolvedValue({ id: "s1", expiresAt: new Date(Date.now() - 1000), admin: admin() });
    db.platformSession.delete.mockResolvedValue({});
    expect(await status(requirePlatformAdmin())).toBe(401);
    expect(db.platformSession.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("inactive admin → 401", async () => {
    jar.set(PLATFORM_COOKIE, "abc");
    db.platformSession.findUnique.mockResolvedValue({ id: "s", expiresAt: future(), admin: admin({ active: false }) });
    expect(await status(requirePlatformAdmin())).toBe(401);
  });

  it("mustChangePassword → 403 unless allowPasswordChangePending", async () => {
    jar.set(PLATFORM_COOKIE, "abc");
    db.platformSession.findUnique.mockResolvedValue({ id: "s", expiresAt: future(), admin: admin({ mustChangePassword: true }) });
    expect(await status(requirePlatformAdmin())).toBe(403);
    expect(await status(requirePlatformAdmin({ allowPasswordChangePending: true }))).toBe("ok");
  });

  it("active admin with a valid session is returned", async () => {
    jar.set(PLATFORM_COOKIE, "abc");
    db.platformSession.findUnique.mockResolvedValue({ id: "s", expiresAt: future(), admin: admin() });
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ id: "pa1" });
  });
});
