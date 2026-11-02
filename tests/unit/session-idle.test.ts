import { beforeEach, describe, expect, it, vi } from "vitest";

// Session idle timeouts (src/lib/session-policy.ts) and how the company
// session lookup applies them. Prisma and the cookie store are mocked.
const db = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), delete: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(), deleteMany: vi.fn() },
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

import { SESSION_COOKIE, createSession, getSessionState, getSessionUser } from "@/lib/auth";
import { requireUser } from "@/lib/api-helpers";
import {
  COMPANY_STAFF_IDLE_TIMEOUT_MS, IDLE_SESSION_MESSAGE, PLATFORM_IDLE_TIMEOUT_MS, SESSION_TOUCH_INTERVAL_MS,
  companyIdleTimeoutMs, isIdleExpired, needsTouch,
} from "@/lib/session-policy";

const HOUR = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

describe("session-policy", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const before = (ms: number) => new Date(now.getTime() - ms);

  it("durations", () => {
    expect(PLATFORM_IDLE_TIMEOUT_MS).toBe(30 * 60_000);
    expect(COMPANY_STAFF_IDLE_TIMEOUT_MS).toBe(24 * HOUR);
    expect(SESSION_TOUCH_INTERVAL_MS).toBe(60_000);
  });

  it("admins/dispatchers have a 24 h idle limit; drivers none", () => {
    expect(companyIdleTimeoutMs("ADMIN")).toBe(24 * HOUR);
    expect(companyIdleTimeoutMs("DISPATCHER")).toBe(24 * HOUR);
    expect(companyIdleTimeoutMs("DRIVER")).toBeNull();
  });

  it("isIdleExpired: strictly beyond the limit; no limit → never; never-stamped sessions get a grace stamp", () => {
    expect(isIdleExpired(before(30 * 60_000 + 1), now, PLATFORM_IDLE_TIMEOUT_MS)).toBe(true);
    expect(isIdleExpired(before(30 * 60_000), now, PLATFORM_IDLE_TIMEOUT_MS)).toBe(false);
    expect(isIdleExpired(before(365 * 24 * HOUR), now, null)).toBe(false);
    expect(isIdleExpired(null, now, PLATFORM_IDLE_TIMEOUT_MS)).toBe(false);
  });

  it("needsTouch: at most once a minute", () => {
    expect(needsTouch(null, now)).toBe(true);
    expect(needsTouch(before(59_000), now)).toBe(false);
    expect(needsTouch(before(60_000), now)).toBe(true);
  });
});

describe("company session lookup", () => {
  const future = () => new Date(Date.now() + 24 * HOUR);
  const user = (role: string) => ({ id: "u1", role, active: true, organization: { status: "ACTIVE" }, driverProfile: null });

  beforeEach(() => {
    vi.clearAllMocks();
    jar.clear();
    jar.set(SESSION_COOKIE, "tok");
  });

  it("admin idle for 25 h → signed out (session deleted) and requireUser says why", async () => {
    db.session.findUnique.mockResolvedValue({ id: "s1", expiresAt: future(), lastSeenAt: ago(25 * HOUR), user: user("ADMIN") });
    expect(await getSessionState()).toEqual({ user: null, ended: "idle" });
    expect(db.session.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    await expect(requireUser()).rejects.toMatchObject({ status: 401, message: IDLE_SESSION_MESSAGE });
  });

  it("dispatcher active 23 h ago → still signed in; lastSeenAt refreshed", async () => {
    db.session.findUnique.mockResolvedValue({ id: "s1", expiresAt: future(), lastSeenAt: ago(23 * HOUR), user: user("DISPATCHER") });
    expect(await getSessionUser()).toMatchObject({ id: "u1" });
    expect(db.session.updateMany).toHaveBeenCalledWith({ where: { id: "s1" }, data: { lastSeenAt: expect.any(Date) } });
  });

  it("driver idle for 6 days → still signed in (no idle limit, only the 7-day absolute TTL)", async () => {
    db.session.findUnique.mockResolvedValue({ id: "s1", expiresAt: future(), lastSeenAt: ago(6 * 24 * HOUR), user: user("DRIVER") });
    expect(await getSessionUser()).toMatchObject({ id: "u1" });
    expect(db.session.delete).not.toHaveBeenCalled();
  });

  it("absolute expiry still applies to drivers", async () => {
    db.session.findUnique.mockResolvedValue({ id: "s1", expiresAt: ago(1000), lastSeenAt: new Date(), user: user("DRIVER") });
    expect(await getSessionState()).toEqual({ user: null });
    await expect(requireUser()).rejects.toMatchObject({ status: 401, message: "Authentication required" });
  });

  it("no DB write when the last stamp is under a minute old", async () => {
    db.session.findUnique.mockResolvedValue({ id: "s1", expiresAt: future(), lastSeenAt: ago(10_000), user: user("ADMIN") });
    await getSessionUser();
    expect(db.session.updateMany).not.toHaveBeenCalled();
  });

  it("sessions from before idle tracking (lastSeenAt null) are stamped, not expired", async () => {
    db.session.findUnique.mockResolvedValue({ id: "s1", expiresAt: future(), lastSeenAt: null, user: user("ADMIN") });
    expect(await getSessionUser()).toMatchObject({ id: "u1" });
    expect(db.session.updateMany).toHaveBeenCalled();
  });

  it("new sessions start with lastSeenAt set", async () => {
    await createSession("u1");
    expect(db.session.create.mock.calls[0][0].data.lastSeenAt).toBeInstanceOf(Date);
  });
});
