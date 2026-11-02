import { beforeEach, describe, expect, it, vi } from "vitest";

// API keys: generation, hashing, Bearer parsing and requireApiKey — Prisma is mocked.
const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  apiKey: { findUnique: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));

import { API_RATE_LIMIT, ApiKeyError, generateApiKey, hashApiKey, parseBearerKey, requireApiKey } from "@/lib/api-keys";

const NOW = new Date("2026-10-29T10:00:00Z");
const KEY = generateApiKey();

const keyRow = (over: Record<string, unknown> = {}) => ({
  id: "key1",
  name: "WooCommerce",
  organizationId: "org1",
  lastUsedAt: null,
  revokedAt: null,
  organization: { status: "ACTIVE", planRecord: { name: "Growth", features: ["api_access"] } },
  ...over,
});

const req = (auth?: string) => new Request("http://localhost/api/v1/deliveries", { headers: auth ? { authorization: auth } : {} });

async function refusal(p: Promise<unknown>): Promise<ApiKeyError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiKeyError);
    return e as ApiKeyError;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.clearAllMocks();
  db.apiKey.findUnique.mockResolvedValue(keyRow());
  db.apiKey.updateMany.mockResolvedValue({ count: 1 });
  db.$queryRaw.mockResolvedValue([{ count: 1, resetAt: new Date(NOW.getTime() + 60_000) }]);
});

describe("key format", () => {
  it("ff_live_ + 43 base64url chars (32 random bytes), unique, prefix is the first 12 chars", () => {
    const keys = Array.from({ length: 50 }, () => generateApiKey());
    for (const k of keys) {
      expect(k.key).toMatch(/^ff_live_[A-Za-z0-9_-]{43}$/);
      expect(k.prefix).toBe(k.key.slice(0, 12));
      expect(k.keyHash).toBe(hashApiKey(k.key));
      expect(k.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(k.keyHash).not.toContain(k.key.slice(8));
    }
    expect(new Set(keys.map((k) => k.key)).size).toBe(50);
  });

  it("hash is SHA-256 hex of the full key", () => {
    expect(hashApiKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("parses only well-formed Bearer keys", () => {
    expect(parseBearerKey(`Bearer ${KEY.key}`)).toBe(KEY.key);
    expect(parseBearerKey(`bearer   ${KEY.key} `)).toBe(KEY.key);
    for (const bad of [null, "", KEY.key, `Basic ${KEY.key}`, "Bearer ", `Bearer ${KEY.key}x`, `Bearer ff_test_${KEY.key.slice(8)}`, `Bearer ${KEY.key} extra`]) {
      expect(parseBearerKey(bad)).toBeNull();
    }
  });
});

describe("requireApiKey", () => {
  it("401 without or with a malformed key — no database lookup", async () => {
    for (const auth of [undefined, "Bearer nope", `Token ${KEY.key}`]) {
      const e = await refusal(requireApiKey(req(auth), NOW));
      expect([e.status, e.code]).toEqual([401, "unauthorized"]);
    }
    expect(db.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("looks the key up by its hash; unknown or revoked → 401", async () => {
    db.apiKey.findUnique.mockResolvedValueOnce(null);
    expect((await refusal(requireApiKey(req(`Bearer ${KEY.key}`), NOW))).status).toBe(401);
    expect(db.apiKey.findUnique.mock.calls[0][0].where).toEqual({ keyHash: KEY.keyHash });

    db.apiKey.findUnique.mockResolvedValueOnce(keyRow({ revokedAt: new Date("2026-10-01") }));
    expect((await refusal(requireApiKey(req(`Bearer ${KEY.key}`), NOW))).status).toBe(401);
  });

  it("suspended company → 403; plan without api_access → 403 naming the plan", async () => {
    db.apiKey.findUnique.mockResolvedValueOnce(keyRow({ organization: { status: "SUSPENDED", planRecord: { name: "Growth", features: ["api_access"] } } }));
    const suspended = await refusal(requireApiKey(req(`Bearer ${KEY.key}`), NOW));
    expect([suspended.status, suspended.code]).toEqual([403, "account_suspended"]);

    db.apiKey.findUnique.mockResolvedValueOnce(keyRow({ organization: { status: "ACTIVE", planRecord: { name: "Starter", features: ["csv_import"] } } }));
    const noPlan = await refusal(requireApiKey(req(`Bearer ${KEY.key}`), NOW));
    expect([noPlan.status, noPlan.code]).toEqual([403, "plan_feature_missing"]);
    expect(noPlan.message).toMatch(/Starter plan/);
    expect(db.$queryRaw).not.toHaveBeenCalled(); // refused before counting
  });

  it("over the per-key limit → 429 with Retry-After seconds", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ count: API_RATE_LIMIT + 1, resetAt: new Date(NOW.getTime() + 42_500) }]);
    const e = await refusal(requireApiKey(req(`Bearer ${KEY.key}`), NOW));
    expect([e.status, e.code, e.retryAfter]).toEqual([429, "rate_limited", 43]);
  });

  it("returns the principal with an actor name for audit rows", async () => {
    const p = await requireApiKey(req(`Bearer ${KEY.key}`), NOW);
    expect(p).toMatchObject({ keyId: "key1", organizationId: "org1", actorName: "API: WooCommerce", rateLimit: { limit: API_RATE_LIMIT, remaining: API_RATE_LIMIT - 1 } });
  });

  it("writes lastUsedAt at most once a minute (conditional update)", async () => {
    await requireApiKey(req(`Bearer ${KEY.key}`), NOW);
    expect(db.apiKey.updateMany).toHaveBeenCalledTimes(1);
    expect(db.apiKey.updateMany.mock.calls[0][0].data).toEqual({ lastUsedAt: NOW });

    db.apiKey.findUnique.mockResolvedValueOnce(keyRow({ lastUsedAt: new Date(NOW.getTime() - 30_000) }));
    await requireApiKey(req(`Bearer ${KEY.key}`), NOW);
    expect(db.apiKey.updateMany).toHaveBeenCalledTimes(1);

    db.apiKey.findUnique.mockResolvedValueOnce(keyRow({ lastUsedAt: new Date(NOW.getTime() - 61_000) }));
    db.apiKey.updateMany.mockRejectedValueOnce(new Error("db hiccup"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(requireApiKey(req(`Bearer ${KEY.key}`), NOW)).resolves.toBeTruthy(); // never fails the request
  });
});
