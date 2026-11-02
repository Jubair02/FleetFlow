import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";

// Public API v1 routes: auth, error shape, tenant isolation, idempotency,
// pagination and cancel rules — Prisma is mocked (no DB).
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  apiKey: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  organization: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  auditLog: { findMany: vi.fn(), create: vi.fn() },
  delivery: { findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  deliveryEvent: { create: vi.fn() },
  user: { count: vi.fn() },
  vehicle: { count: vi.fn() },
  webhookEndpoint: { findMany: vi.fn() },
  webhookDelivery: { findMany: vi.fn() },
  deliveryZone: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));

import { GET as list, POST as create } from "@/app/api/v1/deliveries/route";
import { GET as getOne } from "@/app/api/v1/deliveries/[id]/route";
import { POST as cancel } from "@/app/api/v1/deliveries/[id]/cancel/route";
import { generateApiKey } from "@/lib/api-keys";
import { decodeCursor, encodeCursor } from "@/lib/api-v1";

const KEY = generateApiKey().key;
const plan = (over: Partial<Plan> = {}): Plan => ({
  code: "growth", name: "Growth", description: "", monthlyPriceBdt: 4000, annualPriceBdt: 40000,
  maxDrivers: 20, maxVehicles: 20, maxAdmins: 3, maxMonthlyDeliveries: 3000,
  features: ["api_access"], highlights: [], active: true, isPublic: true, isDefault: false, sortOrder: 2,
  createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"), ...over,
});

const delivery = (over: Record<string, unknown> = {}) => ({
  id: "d1", organizationId: "org1", trackingCode: "FF-261029-ABCD", trackingToken: "tok123", trackingEnabled: true, externalRef: "WC-1001",
  status: "CREATED", priority: "NORMAL", recipientName: "Rahim Uddin", recipientPhone: "01711000000", recipientEmail: null,
  pickupAddress: "Warehouse 3, Tejgaon", deliveryAddress: "House 5, Road 2, Dhanmondi", instructions: null, expectedAt: null,
  completedAt: null, failureReason: null, codAmount: 1200, codCollectedAmount: null, codCollectedAt: null, codSettlementId: null,
  importBatchId: null, codCollectedById: null,
  createdAt: new Date("2026-10-29T08:00:00Z"), updatedAt: new Date("2026-10-29T08:00:00Z"), assignments: [], ...over,
});

const body = { recipientName: "Rahim Uddin", recipientPhone: "01711000000", pickupAddress: "Warehouse 3, Tejgaon", deliveryAddress: "House 5, Road 2, Dhanmondi", externalRef: "WC-1001", codAmount: 1200 };

const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extra });
const post = (payload: unknown, extra: Record<string, string> = {}) =>
  create(new Request("http://localhost/api/v1/deliveries", { method: "POST", headers: headers(extra), body: JSON.stringify(payload) }));
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let rateCount: number;

beforeEach(() => {
  vi.clearAllMocks();
  db.deliveryZone.findMany.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
  rateCount = 1;
  db.apiKey.findUnique.mockResolvedValue({
    id: "key1", name: "WooCommerce", organizationId: "org1", lastUsedAt: new Date(), revokedAt: null,
    organization: { status: "ACTIVE", planRecord: { name: "Growth", features: ["api_access"] } },
  });
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("INSERT INTO")) return [{ count: rateCount, resetAt: new Date(Date.now() + 30_000) }];
    if (sql.includes("subscriptionStatus")) return [{ timezone: "Asia/Dhaka", subscriptionStatus: "ACTIVE", trialEndsAt: null, paidUntil: null }];
    return [{ id: "x" }];
  });
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => unknown) => fn(db));
  db.organization.findUnique.mockResolvedValue({ name: "Acme", planRecord: plan() });
  db.auditLog.findMany.mockResolvedValue([]);
  db.delivery.findFirst.mockResolvedValue(null);
  db.delivery.count.mockResolvedValue(10);
  db.user.count.mockResolvedValue(1);
  db.vehicle.count.mockResolvedValue(1);
  db.delivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => delivery({ ...data, id: "dNew" }));
  db.delivery.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => delivery({ id: where.id }));
  db.webhookEndpoint.findMany.mockResolvedValue([]);
});

describe("auth & error shape", () => {
  it("401 as { error: { code, message } }, no CORS headers", async () => {
    const res = await list(new Request("http://localhost/api/v1/deliveries"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("429 carries Retry-After and rate-limit headers", async () => {
    rateCount = 121;
    const res = await list(new Request("http://localhost/api/v1/deliveries", { headers: headers() }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await res.json()).error.code).toBe("rate_limited");
  });

  it("successful responses carry X-RateLimit-* headers", async () => {
    db.delivery.findMany.mockResolvedValue([]);
    const res = await list(new Request("http://localhost/api/v1/deliveries", { headers: headers() }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("120");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("119");
  });
});

describe("POST /api/v1/deliveries", () => {
  it("creates in the key's organization: 201, public DTO, audited as the API key", async () => {
    const res = await post(body, { "idempotency-key": "order-1001-a" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.delivery).toMatchObject({ id: "dNew", externalRef: "WC-1001", status: "CREATED", codAmount: 1200, driver: null });
    expect(json.delivery.trackingUrl).toMatch(/\/track\/tok123$/);
    expect(json.delivery).not.toHaveProperty("trackingToken");
    expect(db.delivery.create.mock.calls[0][0].data.organizationId).toBe("org1");
    const audit = db.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ organizationId: "org1", actorId: null, actorName: "API: WooCommerce", action: "DELIVERY_CREATED" });
    expect(JSON.parse(audit.detail)).toMatchObject({ via: "api", apiKeyId: "key1", idempotencyKey: "order-1001-a", requestHash: expect.any(String) });
    expect(db.deliveryEvent.create.mock.calls[0][0].data).toMatchObject({ actorName: "API: WooCommerce", eventType: "CREATED" });
  });

  it("validation errors name the field", async () => {
    const res = await post({ ...body, recipientPhone: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: "invalid_request", field: "recipientPhone" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("415 without a JSON content type; 400 on a bad Idempotency-Key", async () => {
    const res = await create(new Request("http://localhost/api/v1/deliveries", { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: "x" }));
    expect(res.status).toBe(415);
    expect((await post(body, { "idempotency-key": "has spaces" })).status).toBe(400);
  });

  it("existing externalRef (not cancelled) → 200 with the existing delivery, nothing created", async () => {
    db.delivery.findFirst.mockResolvedValueOnce({ id: "dOld" });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.headers.get("idempotent-replayed")).toBe("true");
    expect((await res.json()).delivery.id).toBe("dOld");
    expect(db.delivery.findFirst.mock.calls[0][0].where).toEqual({ organizationId: "org1", externalRef: "WC-1001", status: { not: "CANCELLED" } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a replayed Idempotency-Key returns the original; a different body with it is a 409", async () => {
    await post(body, { "idempotency-key": "k-1" });
    const detail = db.auditLog.create.mock.calls[0][0].data.detail;
    vi.clearAllMocks();
    db.auditLog.findMany.mockResolvedValue([{ entityId: "dWild", detail: detail.replace("k-1", "k_1") }, { entityId: "dNew", detail }]);
    db.delivery.findFirst.mockResolvedValue({ id: "dNew" });

    const replay = await post(body, { "idempotency-key": "k-1" });
    expect(replay.status).toBe(200);
    expect((await replay.json()).delivery.id).toBe("dNew");
    const where = db.auditLog.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: "org1", action: "DELIVERY_CREATED", detail: { contains: '"idempotencyKey":"k-1"' } });

    const conflict = await post({ ...body, recipientName: "Someone Else" }, { "idempotency-key": "k-1" });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("idempotency_key_reused");
    expect(db.delivery.create).not.toHaveBeenCalled();
  });

  it("a concurrent retry that committed first is found again under the lock — no duplicate", async () => {
    db.delivery.findFirst
      .mockResolvedValueOnce(null) // fast path: externalRef not there yet
      .mockResolvedValueOnce({ id: "dRace" }); // inside the transaction, after the lock
    const res = await post(body);
    expect(res.status).toBe(200);
    expect((await res.json()).delivery.id).toBe("dRace");
    expect(db.delivery.create).not.toHaveBeenCalled();
    const lockCall = db.$queryRaw.mock.calls.find((c) => (c[0] as TemplateStringsArray).join("?").includes("FOR UPDATE"));
    expect(lockCall).toBeTruthy();
  });

  it("read-only company → 402 subscription_inactive; plan limit → 403 plan_limit_reached", async () => {
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("INSERT INTO")) return [{ count: 1, resetAt: new Date(Date.now() + 30_000) }];
      if (sql.includes("subscriptionStatus")) return [{ timezone: "Asia/Dhaka", subscriptionStatus: "TRIAL", trialEndsAt: new Date("2026-01-01"), paidUntil: null }];
      return [{ id: "x" }];
    });
    const ro = await post({ ...body, externalRef: "" });
    expect(ro.status).toBe(402);
    expect((await ro.json()).error.code).toBe("subscription_inactive");

    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join("?").includes("INSERT INTO")
        ? [{ count: 1, resetAt: new Date(Date.now() + 30_000) }]
        : [{ timezone: "Asia/Dhaka", subscriptionStatus: "ACTIVE", trialEndsAt: null, paidUntil: null }]
    );
    db.delivery.count.mockResolvedValue(3000);
    const limit = await post({ ...body, externalRef: "" });
    expect(limit.status).toBe(403);
    expect((await limit.json()).error.code).toBe("plan_limit_reached");
  });
});

describe("GET /api/v1/deliveries/{id}", () => {
  it("looks up by id or tracking code inside the key's organization only", async () => {
    db.delivery.findFirst.mockResolvedValueOnce({ id: "d1" });
    const res = await getOne(new Request("http://localhost/api/v1/deliveries/ff-261029-abcd", { headers: headers() }), params("ff-261029-abcd"));
    expect(res.status).toBe(200);
    expect(db.delivery.findFirst.mock.calls[0][0].where).toEqual({
      organizationId: "org1",
      OR: [{ id: "ff-261029-abcd" }, { trackingCode: "FF-261029-ABCD" }],
    });
  });

  it("another company's delivery is a 404", async () => {
    db.delivery.findFirst.mockResolvedValueOnce(null);
    const res = await getOne(new Request("http://localhost/api/v1/deliveries/dOther", { headers: headers() }), params("dOther"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(db.delivery.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/deliveries", () => {
  const get = (qs: string) => list(new Request(`http://localhost/api/v1/deliveries${qs}`, { headers: headers() }));

  it("scopes to the organization, validates filters and limit", async () => {
    db.delivery.findMany.mockResolvedValue([]);
    await get("?status=created,failed&externalRef=WC-1");
    const args = db.delivery.findMany.mock.calls[0][0];
    expect(args.where.AND).toEqual([{ organizationId: "org1" }, { status: { in: ["CREATED", "FAILED"] } }, { externalRef: "WC-1" }]);
    expect(args.take).toBe(51);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect((await get("?limit=101")).status).toBe(400);
    expect((await get("?status=LOST")).status).toBe(400);
    expect((await get("?updatedSince=yesterday")).status).toBe(400);
  });

  it("cursor pagination: hasMore + nextCursor, and the cursor narrows the next page", async () => {
    const rows = [delivery({ id: "d3" }), delivery({ id: "d2" }), delivery({ id: "d1" })];
    db.delivery.findMany.mockResolvedValueOnce(rows);
    const first = await (await get("?limit=2")).json();
    expect(first.data.map((d: { id: string }) => d.id)).toEqual(["d3", "d2"]);
    expect(first.hasMore).toBe(true);
    expect(decodeCursor(first.nextCursor, "c")).toEqual({ m: "c", v: "2026-10-29T08:00:00.000Z", id: "d2" });

    db.delivery.findMany.mockResolvedValueOnce([rows[2]]);
    const second = await (await get(`?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    const v = new Date("2026-10-29T08:00:00.000Z");
    expect(db.delivery.findMany.mock.calls[1][0].where.AND).toContainEqual({ OR: [{ createdAt: { lt: v } }, { createdAt: v, id: { lt: "d2" } }] });
  });

  it("updatedSince sorts by change time ascending; cursors don't mix modes", async () => {
    db.delivery.findMany.mockResolvedValue([]);
    await get("?updatedSince=2026-10-01T00:00:00Z");
    expect(db.delivery.findMany.mock.calls[0][0].orderBy).toEqual([{ updatedAt: "asc" }, { id: "asc" }]);
    const createdCursor = encodeCursor({ m: "c", v: "2026-10-29T08:00:00.000Z", id: "d2" });
    const res = await get(`?updatedSince=2026-10-01T00:00:00Z&cursor=${createdCursor}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_cursor");
  });
});

describe("POST /api/v1/deliveries/{id}/cancel", () => {
  const doCancel = (id: string, payload: unknown) =>
    cancel(new Request(`http://localhost/api/v1/deliveries/${id}/cancel`, { method: "POST", headers: headers(), body: JSON.stringify(payload) }), params(id));

  beforeEach(() => {
    db.delivery.findFirst.mockResolvedValue({ id: "d1" });
    db.delivery.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => delivery({ ...data }));
  });

  it("a reason is required", async () => {
    const res = await doCancel("d1", {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.field).toBe("reason");
  });

  it("cancels a pending delivery: CANCELLED, audited as the key, customer-visible event", async () => {
    db.delivery.findUniqueOrThrow.mockResolvedValueOnce(delivery({ status: "CREATED" })).mockResolvedValue(delivery({ status: "CANCELLED" }));
    const res = await doCancel("d1", { reason: "Customer cancelled the order" });
    expect(res.status).toBe(200);
    expect((await res.json()).delivery.status).toBe("CANCELLED");
    expect(db.delivery.update.mock.calls[0][0].data).toEqual({ status: "CANCELLED", failureReason: null });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorName: "API: WooCommerce", action: "STATUS_CANCELLED" });
    expect(db.deliveryEvent.create.mock.calls[0][0].data).toMatchObject({ eventType: "CANCELLED", note: "Customer cancelled the order", customerVisible: true });
  });

  it("a delivery already with a driver can't be cancelled through the API (409)", async () => {
    db.delivery.findUniqueOrThrow.mockResolvedValue(delivery({ status: "ASSIGNED" }));
    const res = await doCancel("d1", { reason: "Changed my mind" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    expect(db.delivery.update).not.toHaveBeenCalled();
  });

  it("cancelling twice is a harmless 200", async () => {
    db.delivery.findUniqueOrThrow.mockResolvedValue(delivery({ status: "CANCELLED" }));
    const res = await doCancel("d1", { reason: "again" });
    expect(res.status).toBe(200);
    expect(db.delivery.update).not.toHaveBeenCalled();
  });
});
