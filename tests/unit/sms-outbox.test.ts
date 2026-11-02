import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  AUTO_RETRY_MAX_AGE_MS,
  autoRetryWhere,
  findDueRows,
  isDueForAutoRetry,
  MAX_ATTEMPTS,
  retryBackoffMs,
  retryDueOutbox,
  retryOutbox,
  type DispatchResult,
} from "@/lib/email/outbox";
import { createPrismaSmsOutboxStore, dispatchSms, queueAndSendSms, smsLane, type NewSms } from "@/lib/sms/outbox";
import { SmsSendError, type SmsProvider } from "@/lib/sms/provider";

function mockPrisma() {
  const notification = {
    create: vi.fn().mockResolvedValue({ id: "s1" }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue({ id: "s1", recipientPhone: "8801712345678", body: "Hello" }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  return { notification, client: { notification } as unknown as Pick<PrismaClient, "notification"> };
}

function provider(opts: { simulated?: boolean; fail?: unknown } = {}) {
  const send = vi.fn(async () => {
    if (opts.fail) throw opts.fail;
    return { id: "bsms_1" };
  });
  const p: SmsProvider = { name: opts.simulated ? "console" : "bulksmsbd", simulated: !!opts.simulated, send };
  return { p, send };
}

const sms: NewSms = {
  organizationId: "org1",
  deliveryId: "d1",
  type: "TRACKING",
  recipientPhone: "8801712345678",
  title: "Tracking link · FF-1",
  text: "Hello",
  dedupeKey: "sms:tracking:d1:8801712345678",
};

describe("Prisma SMS outbox store", () => {
  it("inserts PENDING SMS rows with the phone and dedupe key", async () => {
    const { notification, client } = mockPrisma();
    await expect(createPrismaSmsOutboxStore(client).insert(sms)).resolves.toEqual({ id: "s1" });
    expect(notification.create.mock.calls[0][0].data).toMatchObject({
      organizationId: "org1",
      userId: null,
      deliveryId: "d1",
      channel: "SMS",
      status: "PENDING",
      recipientPhone: "8801712345678",
      title: sms.title,
      body: "Hello",
      dedupeKey: sms.dedupeKey,
    });
  });

  it("returns null on a dedupe conflict", async () => {
    const { notification, client } = mockPrisma();
    notification.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002", meta: { target: ["dedupeKey"] } }));
    await expect(createPrismaSmsOutboxStore(client).insert(sms)).resolves.toBeNull();
  });

  it("claims SMS rows atomically and stamps lastAttemptAt", async () => {
    const { notification, client } = mockPrisma();
    const store = createPrismaSmsOutboxStore(client);
    const now = new Date("2026-10-29T10:00:00Z");
    expect(await store.claim("s1", "fresh", now)).toBe(true);
    expect(notification.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "s1", channel: "SMS", status: "PENDING", attempts: { lt: MAX_ATTEMPTS } },
      data: { status: "SENDING", attempts: { increment: 1 }, sentAt: now, lastAttemptAt: now },
    });
    notification.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await store.claim("s1", "retry", now)).toBe(false);
    expect(notification.updateMany.mock.calls[1][0].where).toMatchObject({ id: "s1", channel: "SMS", attempts: { lt: MAX_ATTEMPTS } });
  });

  it("findRetryable is scoped to SMS rows of the organization", async () => {
    const { notification, client } = mockPrisma();
    notification.findMany.mockResolvedValue([{ id: "s1" }]);
    expect(await createPrismaSmsOutboxStore(client).findRetryable("org1", new Date(), ["s1"])).toEqual(["s1"]);
    expect(notification.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: "org1", channel: "SMS", id: { in: ["s1"] } });
  });
});

describe("SMS dispatch", () => {
  it("sends to the stored phone and marks SENT", async () => {
    const { notification, client } = mockPrisma();
    const { p, send } = provider();
    const r = await queueAndSendSms(createPrismaSmsOutboxStore(client), p, sms);
    expect(r).toEqual({ queued: true, id: "s1", result: "SENT" });
    expect(send).toHaveBeenCalledWith({ to: "8801712345678", text: "Hello", idempotencyKey: "fleetflow-notification-s1" });
    expect(notification.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: "SENT", providerMessageId: "bsms_1" });
  });

  it("console mode marks SIMULATED", async () => {
    const { notification, client } = mockPrisma();
    expect(await dispatchSms(createPrismaSmsOutboxStore(client), provider({ simulated: true }).p, "s1")).toBe("SIMULATED");
    expect(notification.updateMany.mock.calls.at(-1)![0].data.status).toBe("SIMULATED");
  });

  it("provider errors are recorded as FAILED, never thrown", async () => {
    const { notification, client } = mockPrisma();
    const { p } = provider({ fail: new SmsSendError("BulkSMSBD 1007: insufficient balance") });
    expect(await dispatchSms(createPrismaSmsOutboxStore(client), p, "s1")).toBe("FAILED");
    expect(notification.updateMany.mock.calls.at(-1)![0].data).toEqual({ status: "FAILED", sentAt: null, lastError: "BulkSMSBD 1007: insufficient balance" });
  });

  it("rows without a phone fail without calling the provider", async () => {
    const { notification, client } = mockPrisma();
    notification.findUnique.mockResolvedValue({ id: "s1", recipientPhone: null, body: "Hello" });
    const { p, send } = provider();
    expect(await dispatchSms(createPrismaSmsOutboxStore(client), p, "s1")).toBe("FAILED");
    expect(send).not.toHaveBeenCalled();
  });

  it("a row that can't be claimed is skipped", async () => {
    const { notification, client } = mockPrisma();
    notification.updateMany.mockResolvedValueOnce({ count: 0 });
    const { p, send } = provider();
    expect(await dispatchSms(createPrismaSmsOutboxStore(client), p, "s1", "retry")).toBe("SKIPPED");
    expect(send).not.toHaveBeenCalled();
  });

  it("manual retry covers SMS lanes alongside email", async () => {
    const { notification, client } = mockPrisma();
    notification.findMany.mockResolvedValue([{ id: "s1" }]);
    const store = createPrismaSmsOutboxStore(client);
    const emailLane = { findRetryable: vi.fn(async () => ["e1"]), dispatch: vi.fn(async (): Promise<DispatchResult> => "SENT") };
    const s = await retryOutbox([emailLane, smsLane(store, provider().p)], "org1", { ids: ["e1", "s1", "x9"] });
    expect(s).toEqual({ attempted: 2, sent: 2, simulated: 0, failed: 0, skipped: 1 });
  });
});

describe("automatic retry selection", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;

  it("backs off 5 min × 2^(attempts-1), capped at 6 h", () => {
    expect(retryBackoffMs(0)).toBe(5 * MIN);
    expect(retryBackoffMs(1)).toBe(5 * MIN);
    expect(retryBackoffMs(2)).toBe(10 * MIN);
    expect(retryBackoffMs(3)).toBe(20 * MIN);
    expect(retryBackoffMs(20)).toBe(6 * 60 * MIN);
  });

  it("FAILED rows are due only after their backoff and while attempts remain", () => {
    const row = (attempts: number, lastAttemptAt: Date | null) => ({ status: "FAILED", attempts, createdAt: ago(60 * MIN), sentAt: null, lastAttemptAt });
    expect(isDueForAutoRetry(row(1, ago(4 * MIN)), now)).toBe(false);
    expect(isDueForAutoRetry(row(1, ago(6 * MIN)), now)).toBe(true);
    expect(isDueForAutoRetry(row(2, ago(9 * MIN)), now)).toBe(false);
    expect(isDueForAutoRetry(row(2, ago(11 * MIN)), now)).toBe(true);
    expect(isDueForAutoRetry(row(MAX_ATTEMPTS, ago(600 * MIN)), now)).toBe(false);
    expect(isDueForAutoRetry(row(1, null), now)).toBe(true); // legacy row: falls back to createdAt
  });

  it("stale PENDING / stuck SENDING rows are due; finished and very old rows are not", () => {
    const base = { attempts: 0, sentAt: null, lastAttemptAt: null };
    expect(isDueForAutoRetry({ ...base, status: "PENDING", createdAt: ago(3 * MIN) }, now)).toBe(true);
    expect(isDueForAutoRetry({ ...base, status: "PENDING", createdAt: ago(1 * MIN) }, now)).toBe(false);
    expect(isDueForAutoRetry({ ...base, attempts: 1, status: "SENDING", createdAt: ago(60 * MIN), sentAt: ago(6 * MIN) }, now)).toBe(true);
    expect(isDueForAutoRetry({ ...base, status: "SENT", createdAt: ago(60 * MIN) }, now)).toBe(false);
    expect(isDueForAutoRetry({ ...base, status: "SIMULATED", createdAt: ago(60 * MIN) }, now)).toBe(false);
    expect(isDueForAutoRetry({ ...base, attempts: 1, status: "FAILED", createdAt: ago(AUTO_RETRY_MAX_AGE_MS + MIN) }, now)).toBe(false);
  });

  it("autoRetryWhere encodes the same rule for Prisma", () => {
    const w = autoRetryWhere(now);
    expect(w.attempts).toEqual({ lt: MAX_ATTEMPTS });
    expect(w.createdAt).toEqual({ gte: ago(AUTO_RETRY_MAX_AGE_MS) });
    expect(w.OR).toContainEqual({ status: "FAILED", attempts: 1, lastAttemptAt: { lt: ago(5 * MIN) } });
    expect(w.OR).toContainEqual({ status: "FAILED", attempts: 2, lastAttemptAt: { lt: ago(10 * MIN) } });
    expect(w.OR).toContainEqual({ status: "FAILED", attempts: 2, lastAttemptAt: null, createdAt: { lt: ago(10 * MIN) } });
    expect(w.OR).toContainEqual({ status: "PENDING", createdAt: { lt: ago(2 * MIN) } });
    expect(w.OR).toContainEqual({ status: "SENDING", sentAt: { lt: ago(5 * MIN) } });
    expect(w.OR).not.toContainEqual({ status: "FAILED" });
  });

  it("findDueRows looks at EMAIL and SMS rows of every organization, oldest first, bounded", async () => {
    const { notification, client } = mockPrisma();
    notification.findMany.mockResolvedValue([{ id: "s1", channel: "SMS" }]);
    expect(await findDueRows(client, now, 50)).toEqual([{ id: "s1", channel: "SMS" }]);
    const args = notification.findMany.mock.calls[0][0];
    expect(args.where.channel).toEqual({ in: ["EMAIL", "SMS"] });
    expect(args.where.organizationId).toBeUndefined();
    expect(args.take).toBe(50);
    expect(args.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("retryDueOutbox dispatches by channel with bounded concurrency", async () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, channel: "EMAIL" })),
      { id: "s1", channel: "SMS" },
      { id: "x1", channel: "IN_APP" },
    ];
    let active = 0;
    let peak = 0;
    const slow = (result: DispatchResult) =>
      vi.fn(async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return result;
      });
    const EMAIL = slow("SENT");
    const SMS = slow("FAILED");
    const s = await retryDueOutbox(async () => rows, { EMAIL, SMS }, { now, concurrency: 4 });
    expect(s).toEqual({ attempted: 8, sent: 6, simulated: 0, failed: 1, skipped: 1 });
    expect(SMS).toHaveBeenCalledWith("s1", now);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("retryDueOutbox caps the batch at 50", async () => {
    const findDue = vi.fn(async (_now: Date, limit: number) => Array.from({ length: limit + 10 }, (_, i) => ({ id: `e${i}`, channel: "EMAIL" })));
    const s = await retryDueOutbox(findDue, { EMAIL: async () => "SIMULATED" }, { limit: 500 });
    expect(findDue.mock.calls[0][1]).toBe(50);
    expect(s.attempted).toBe(50);
    expect(s.simulated).toBe(50);
  });
});
