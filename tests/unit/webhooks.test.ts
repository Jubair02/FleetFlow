import { createHmac } from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Webhooks: signatures, backoff, SSRF checks, queueing and the send state
// machine — Prisma is mocked; postWebhook is exercised against a local server.
const db = vi.hoisted(() => ({
  webhookDelivery: { updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  webhookEndpoint: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  organization: { findUnique: vi.fn() },
  delivery: { findUniqueOrThrow: vi.fn() },
  auditLog: { create: vi.fn() },
  user: { findMany: vi.fn() },
  notification: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/webhook-url", async (orig) => ({ ...(await orig<typeof import("@/lib/webhook-url")>()), postWebhook: post }));

import {
  AUTO_DISABLE_AFTER,
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
  deliverWebhook,
  nextRetryDelay,
  queueDeliveryStatusChange,
  queueWebhookEvents,
  signWebhookPayload,
  signatureHeader,
  truncateError,
  verifyWebhookSignature,
} from "@/lib/webhooks";
import { isBlockedAddress, validateWebhookUrl } from "@/lib/webhook-url";

let realUrl: typeof import("@/lib/webhook-url");
beforeAll(async () => {
  realUrl = await vi.importActual<typeof import("@/lib/webhook-url")>("@/lib/webhook-url");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signature", () => {
  const secret = "whsec_test";
  const body = '{"type":"ping"}';
  const now = new Date("2026-10-29T10:00:00Z");

  it("v1 = hex HMAC-SHA256 of `<t>.<body>`", () => {
    const t = Math.floor(now.getTime() / 1000);
    expect(signatureHeader(secret, body, now)).toBe(`t=${t},v1=${signWebhookPayload(secret, t, body)}`);
    expect(signWebhookPayload(secret, 1700000000, "{}")).toBe(createHmac("sha256", secret).update("1700000000.{}").digest("hex"));
  });

  it("verifies, and rejects tampering, wrong secrets and stale timestamps", () => {
    const header = signatureHeader(secret, body, now);
    expect(verifyWebhookSignature(secret, header, body, { now })).toBe(true);
    expect(verifyWebhookSignature(secret, header, body + " ", { now })).toBe(false);
    expect(verifyWebhookSignature("whsec_other", header, body, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, header, body, { now: new Date(now.getTime() + 301_000) })).toBe(false);
    expect(verifyWebhookSignature(secret, "t=abc,v1=00", body, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, null, body, { now })).toBe(false);
  });
});

describe("retry schedule", () => {
  it("8 attempts spread over about a day, then give up", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    const delays = Array.from({ length: WEBHOOK_MAX_ATTEMPTS }, (_, i) => nextRetryDelay(i + 1));
    expect(delays.slice(0, 7)).toEqual([...WEBHOOK_BACKOFF_MS]);
    expect(delays[7]).toBeNull();
    expect(nextRetryDelay(0)).toBeNull();
    for (let i = 1; i < 7; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    const total = WEBHOOK_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(18 * 3_600_000);
    expect(total).toBeLessThan(26 * 3_600_000);
  });

  it("error text is collapsed and capped at ~1 KB", () => {
    expect(truncateError("a\n\n  b")).toBe("a b");
    expect(truncateError("x".repeat(5000)).length).toBe(1000);
  });
});

describe("SSRF address checks", () => {
  it("blocks private, loopback, link-local, metadata, CGNAT, reserved and mapped addresses", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
      "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fd00:ec2::254", "fc00::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1", "not-an-ip",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "104.16.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("validates URLs: https only, no credentials, no private literals or internal names", () => {
    expect(validateWebhookUrl("https://shop.example.com/hook#x", { allowLocal: false })).toBe("https://shop.example.com/hook");
    for (const bad of [
      "http://shop.example.com/hook",
      "ftp://shop.example.com",
      "https://user:pw@shop.example.com/",
      "https://127.0.0.1/hook",
      "https://2130706433/hook", // 127.0.0.1 in decimal
      "https://[::1]/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/",
      "https://localhost/hook",
      "https://metadata.google.internal/",
      "https://intranet/",
      "not a url",
      "",
    ]) {
      expect(() => validateWebhookUrl(bad, { allowLocal: false }), bad).toThrow();
    }
  });

  it("http://localhost only outside production", () => {
    expect(validateWebhookUrl("http://localhost:4000/hook", { allowLocal: true })).toBe("http://localhost:4000/hook");
    expect(validateWebhookUrl("http://127.0.0.1:4000/hook", { allowLocal: true })).toBe("http://127.0.0.1:4000/hook");
    expect(() => validateWebhookUrl("http://localhost:4000/hook", { allowLocal: false })).toThrow();
    expect(() => validateWebhookUrl("http://10.0.0.5/hook", { allowLocal: true })).toThrow();
    expect(() => validateWebhookUrl("http://example.com/hook", { allowLocal: true })).toThrow(/https/);
  });
});

describe("postWebhook against a local server", () => {
  let server: http.Server;
  let base: string;
  const seen: { headers: http.IncomingHttpHeaders; body: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ headers: req.headers, body });
        if (req.url === "/redirect") {
          res.writeHead(302, { location: "http://169.254.169.254/" }).end();
        } else if (req.url === "/big") {
          res.writeHead(500).end("e".repeat(100_000));
        } else if (req.url === "/slow") {
          setTimeout(() => res.writeHead(200).end("late"), 1500);
        } else {
          res.writeHead(204).end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("POSTs the body and headers; 2xx comes back", async () => {
    const res = await realUrl.postWebhook({ url: `${base}/ok`, body: '{"a":1}', headers: { "FleetFlow-Event": "ping" }, allowLocal: true });
    expect(res.status).toBe(204);
    expect(seen.at(-1)).toMatchObject({ body: '{"a":1}', headers: { "fleetflow-event": "ping", "content-length": "7" } });
  });

  it("does not follow redirects and caps the response body", async () => {
    const redirect = await realUrl.postWebhook({ url: `${base}/redirect`, body: "{}", headers: {}, allowLocal: true });
    expect([redirect.status, redirect.location]).toEqual([302, "http://169.254.169.254/"]);
    const big = await realUrl.postWebhook({ url: `${base}/big`, body: "{}", headers: {}, allowLocal: true, maxBodyBytes: 1024 });
    expect(big.status).toBe(500);
    expect(big.body.length).toBeLessThanOrEqual(1024);
  });

  it("times out", async () => {
    await expect(realUrl.postWebhook({ url: `${base}/slow`, body: "{}", headers: {}, allowLocal: true, timeoutMs: 200 })).rejects.toThrow(/Timed out/);
  });

  it("the DNS guard refuses names that resolve to blocked addresses (rebinding-safe: the checked address is used)", async () => {
    const resolve = (allowLoopback: boolean, all: boolean) =>
      new Promise<{ err: Error | null; address: unknown }>((r) =>
        realUrl.guardedLookup(allowLoopback)("localhost", { all }, (err, address) => r({ err, address }))
      );
    const refused = await resolve(false, false);
    expect(refused.err?.message).toMatch(/private or reserved/);
    const allowed = await resolve(true, true);
    expect(allowed.err).toBeNull();
    expect(Array.isArray(allowed.address)).toBe(true);
  });

  it("refuses loopback when local targets aren't allowed (production)", async () => {
    await expect(realUrl.postWebhook({ url: `${base}/ok`, body: "{}", headers: {}, allowLocal: false })).rejects.toThrow();
  });
});

// ── queueing ─────────────────────────────────────────────────

const tx = db as unknown as Parameters<typeof queueWebhookEvents>[0];
const deliveryRow = {
  id: "d1", trackingCode: "FF-261029-ABCD", trackingToken: "tok", trackingEnabled: true, externalRef: "WC-1", status: "DELIVERED",
  priority: "NORMAL", recipientName: "Rahim", recipientPhone: "01711000000", recipientEmail: null, pickupAddress: "Warehouse",
  deliveryAddress: "House 1", instructions: "internal-looking note", expectedAt: null, completedAt: new Date("2026-10-29T09:00:00Z"),
  failureReason: null, codAmount: 500, codCollectedAmount: 500, codCollectedAt: new Date("2026-10-29T09:00:00Z"),
  createdAt: new Date("2026-10-28T09:00:00Z"), updatedAt: new Date("2026-10-29T09:00:00Z"),
  assignments: [{ active: true, assignedAt: new Date("2026-10-29T08:00:00Z"), driver: { name: "Karim" } }],
};

describe("queueWebhookEvents", () => {
  beforeEach(() => {
    db.organization.findUnique.mockResolvedValue({ planRecord: { features: ["api_access"] } });
    db.delivery.findUniqueOrThrow.mockResolvedValue(deliveryRow);
  });

  it("no subscribed endpoint → nothing loaded or written", async () => {
    db.webhookEndpoint.findMany.mockResolvedValue([]);
    const loader = vi.fn();
    expect(await queueWebhookEvents(tx, "org1", [{ event: "delivery.created", data: loader }])).toBe(0);
    expect(loader).not.toHaveBeenCalled();
    expect(db.webhookDelivery.createMany).not.toHaveBeenCalled();
    expect(db.webhookEndpoint.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org1", active: true, events: { hasSome: ["delivery.created"] } });
  });

  it("plan without api_access → nothing queued", async () => {
    db.webhookEndpoint.findMany.mockResolvedValue([{ id: "e1", events: ["delivery.created"] }]);
    db.organization.findUnique.mockResolvedValue({ planRecord: { features: [] } });
    expect(await queueWebhookEvents(tx, "org1", [{ event: "delivery.created", data: {} }])).toBe(0);
    expect(db.webhookDelivery.createMany).not.toHaveBeenCalled();
  });

  it("status change → one row per subscribed endpoint and event, with old/new status and the public DTO", async () => {
    db.webhookEndpoint.findMany.mockResolvedValue([
      { id: "e1", events: ["delivery.status_changed", "delivery.delivered"] },
      { id: "e2", events: ["delivery.delivered"] },
    ]);
    expect(await queueDeliveryStatusChange(tx, "org1", "d1", "IN_TRANSIT", "DELIVERED")).toBe(3);
    const rows = db.webhookDelivery.createMany.mock.calls[0][0].data as { endpointId: string; event: string; payload: string; organizationId: string }[];
    expect(rows.map((r) => [r.endpointId, r.event])).toEqual([
      ["e1", "delivery.status_changed"],
      ["e1", "delivery.delivered"],
      ["e2", "delivery.delivered"],
    ]);
    expect(db.delivery.findUniqueOrThrow).toHaveBeenCalledTimes(1); // loaded once
    const payload = JSON.parse(rows[0].payload);
    expect(payload).toMatchObject({ type: "delivery.status_changed", apiVersion: "v1", data: { previousStatus: "IN_TRANSIT", status: "DELIVERED" } });
    expect(payload.id).toMatch(/^evt_[0-9a-f]{24}$/);
    const dto = payload.data.delivery;
    expect(dto).toMatchObject({ id: "d1", externalRef: "WC-1", status: "DELIVERED", driver: { name: "Karim" }, codCollectedAmount: 500 });
    expect(dto.trackingUrl).toMatch(/\/track\/tok$/);
    expect(dto).not.toHaveProperty("trackingToken");
    expect(JSON.stringify(dto)).not.toMatch(/driverId|vehicleId|registration/);
    expect(rows.every((r) => r.organizationId === "org1")).toBe(true);
  });
});

// ── sending ──────────────────────────────────────────────────

const row = (over: Record<string, unknown> = {}) => ({
  id: "wd1",
  event: "delivery.created",
  payload: '{"type":"delivery.created"}',
  attempts: 1,
  endpoint: { id: "e1", url: "https://shop.example.com/hook", secret: "whsec_x", active: true, organizationId: "org1" },
  ...over,
});

describe("deliverWebhook", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  beforeEach(() => {
    db.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
    db.webhookDelivery.findUnique.mockResolvedValue(row());
    db.webhookEndpoint.updateMany.mockResolvedValue({ count: 1 });
    db.webhookEndpoint.update.mockResolvedValue({ consecutiveFailures: 1, active: true, url: "https://shop.example.com/hook" });
    db.user.findMany.mockResolvedValue([{ id: "admin1" }]);
  });

  it("claims atomically first; an unclaimable row is skipped without sending", async () => {
    db.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await deliverWebhook("wd1", now)).toBe("SKIPPED");
    expect(post).not.toHaveBeenCalled();
    const claim = db.webhookDelivery.updateMany.mock.calls[0][0];
    expect(claim.data).toEqual({ status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: now });
    expect(claim.where.id).toBe("wd1");
    expect(claim.where.OR).toEqual([
      { status: "PENDING", nextAttemptAt: { lte: now } },
      { status: "SENDING", lastAttemptAt: { lt: new Date(now.getTime() - 120_000) } },
    ]);
  });

  it("2xx → SUCCEEDED, signed headers, failure count reset", async () => {
    post.mockResolvedValue({ status: 200, body: "ok", location: null });
    expect(await deliverWebhook("wd1", now)).toBe("SUCCEEDED");
    const sent = post.mock.calls[0][0];
    expect(sent.headers).toMatchObject({ "FleetFlow-Event": "delivery.created", "FleetFlow-Delivery": "wd1", "Content-Type": "application/json" });
    expect(verifyWebhookSignature("whsec_x", sent.headers["FleetFlow-Signature"], sent.body)).toBe(true);
    expect(sent.timeoutMs).toBe(10_000);
    const fin = db.webhookDelivery.updateMany.mock.calls[1][0];
    expect(fin).toEqual({ where: { id: "wd1", status: "SENDING" }, data: { status: "SUCCEEDED", responseStatus: 200, lastError: null } });
    expect(db.webhookEndpoint.updateMany).toHaveBeenCalledWith({ where: { id: "e1", consecutiveFailures: { gt: 0 } }, data: { consecutiveFailures: 0 } });
  });

  it("non-2xx → back to PENDING with backoff; the last attempt → FAILED", async () => {
    post.mockResolvedValue({ status: 503, body: "down", location: null });
    expect(await deliverWebhook("wd1", now)).toBe("RETRYING");
    expect(db.webhookDelivery.updateMany.mock.calls[1][0].data).toEqual({
      status: "PENDING", responseStatus: 503, lastError: "HTTP 503: down", nextAttemptAt: new Date(now.getTime() + WEBHOOK_BACKOFF_MS[0]),
    });

    vi.clearAllMocks();
    db.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
    db.webhookEndpoint.update.mockResolvedValue({ consecutiveFailures: 2, active: true, url: "u" });
    db.webhookDelivery.findUnique.mockResolvedValue(row({ attempts: WEBHOOK_MAX_ATTEMPTS }));
    post.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await deliverWebhook("wd1", now)).toBe("FAILED");
    expect(db.webhookDelivery.updateMany.mock.calls[1][0].data).toEqual({ status: "FAILED", responseStatus: null, lastError: "ECONNREFUSED" });
  });

  it("a redirect is a failure", async () => {
    post.mockResolvedValue({ status: 301, body: "", location: "https://elsewhere.example.com/" });
    expect(await deliverWebhook("wd1", now)).toBe("RETRYING");
    expect(db.webhookDelivery.updateMany.mock.calls[1][0].data.lastError).toMatch(/redirects are not followed/);
  });

  it(`auto-disables after ${AUTO_DISABLE_AFTER} failures in a row and tells the admins once`, async () => {
    post.mockResolvedValue({ status: 500, body: "", location: null });
    db.webhookEndpoint.update.mockResolvedValue({ consecutiveFailures: AUTO_DISABLE_AFTER, active: true, url: "https://shop.example.com/hook" });
    await deliverWebhook("wd1", now);
    expect(db.webhookEndpoint.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", active: true },
      data: { active: false, disabledAt: now, disabledReason: expect.stringMatching(/Disabled automatically/) },
    });
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ userId: "admin1", type: "WEBHOOK_DISABLED" });
    expect(db.user.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: "org1", role: "ADMIN" });

    // another instance already disabled it: no second notification
    vi.clearAllMocks();
    db.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
    db.webhookEndpoint.update.mockResolvedValue({ consecutiveFailures: AUTO_DISABLE_AFTER + 1, active: true, url: "u" });
    db.webhookEndpoint.updateMany.mockResolvedValue({ count: 0 });
    await deliverWebhook("wd1", now);
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("ping is tried once and never counts towards auto-disable", async () => {
    db.webhookDelivery.findUnique.mockResolvedValue(row({ event: "ping" }));
    post.mockResolvedValue({ status: 404, body: "", location: null });
    expect(await deliverWebhook("wd1", now)).toBe("FAILED");
    expect(db.webhookEndpoint.update).not.toHaveBeenCalled();
  });

  it("a disabled endpoint's row is failed without sending", async () => {
    db.webhookDelivery.findUnique.mockResolvedValue(row({ endpoint: { ...row().endpoint, active: false } }));
    expect(await deliverWebhook("wd1", now)).toBe("FAILED");
    expect(post).not.toHaveBeenCalled();
  });
});
