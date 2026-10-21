import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { EmailSendError, type EmailProvider } from "@/lib/email/provider";
import {
  createPrismaOutboxStore,
  dispatchEmail,
  isRetryable,
  MAX_ATTEMPTS,
  queueAndSend,
  retryEmails,
  shortError,
  type ClaimMode,
  type NewEmail,
  type OutboxStore,
} from "@/lib/email/outbox";

// ── in-memory store with the same semantics as the Prisma store ──

interface Row {
  id: string;
  organizationId: string;
  recipientEmail: string | null;
  subject: string;
  text: string;
  status: string | null;
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  providerMessageId: string | null;
  dedupeKey: string | null;
}

function memoryStore(companyName = "Rahman Traders") {
  const rows = new Map<string, Row>();
  let seq = 0;
  const store: OutboxStore = {
    async insert(e: NewEmail) {
      if (e.dedupeKey && [...rows.values()].some((r) => r.dedupeKey === e.dedupeKey)) return null;
      const id = `n${++seq}`;
      rows.set(id, {
        id,
        organizationId: e.organizationId,
        recipientEmail: e.recipientEmail,
        subject: e.subject,
        text: e.text,
        status: "PENDING",
        attempts: 0,
        createdAt: new Date(),
        sentAt: null,
        lastError: null,
        providerMessageId: null,
        dedupeKey: e.dedupeKey ?? null,
      });
      return { id };
    },
    async claim(id: string, mode: ClaimMode, now: Date) {
      const r = rows.get(id);
      if (!r) return false;
      const ok = mode === "fresh" ? r.status === "PENDING" && r.attempts < MAX_ATTEMPTS : isRetryable(r, now);
      if (!ok) return false;
      Object.assign(r, { status: "SENDING", attempts: r.attempts + 1, sentAt: now });
      return true;
    },
    async get(id: string) {
      const r = rows.get(id);
      return r ? { id, recipientEmail: r.recipientEmail, subject: r.subject, text: r.text, companyName } : null;
    },
    async markSent(id, providerMessageId, now) {
      Object.assign(rows.get(id)!, { status: "SENT", sentAt: now, providerMessageId, lastError: null });
    },
    async markSimulated(id, providerMessageId, now) {
      Object.assign(rows.get(id)!, { status: "SIMULATED", sentAt: now, providerMessageId, lastError: null });
    },
    async markFailed(id, error) {
      Object.assign(rows.get(id)!, { status: "FAILED", sentAt: null, lastError: error });
    },
    async findRetryable(organizationId, now, ids) {
      return [...rows.values()]
        .filter((r) => r.organizationId === organizationId && (!ids || ids.includes(r.id)) && isRetryable(r, now))
        .map((r) => r.id);
    },
  };
  return { store, rows };
}

function provider(opts: { simulated?: boolean; fail?: unknown[] } = {}) {
  const failures = [...(opts.fail ?? [])];
  const send = vi.fn(async () => {
    const f = failures.shift();
    if (f) throw f;
    return { id: `msg_${send.mock.calls.length}` };
  });
  const p: EmailProvider = { name: opts.simulated ? "console" : "resend", simulated: !!opts.simulated, send };
  return { p, send };
}

const email: NewEmail = {
  organizationId: "org1",
  type: "DELIVERED",
  recipientEmail: "c@x.com",
  subject: "Your delivery FF-1 was delivered",
  text: "Hello\n\nhttps://x.io/?track=t",
  dedupeKey: "customer-delivered:d1:c@x.com",
};

describe("email outbox state machine", () => {
  it("queues PENDING then sends: SENT with provider id, attempts=1", async () => {
    const { store, rows } = memoryStore();
    const { p, send } = provider();
    const r = await queueAndSend(store, p, email);
    expect(r).toEqual({ queued: true, id: "n1", result: "SENT" });
    const row = rows.get("n1")!;
    expect(row).toMatchObject({ status: "SENT", attempts: 1, providerMessageId: "msg_1", lastError: null });
    expect(row.sentAt).toBeInstanceOf(Date);
    const msg = (send.mock.calls[0] as unknown[])[0] as Record<string, string>;
    expect(msg).toMatchObject({
      to: "c@x.com",
      subject: email.subject,
      text: email.text,
      idempotencyKey: "fleetflow-notification-n1",
      fromName: "Rahman Traders via FleetFlow",
    });
    expect(msg.html).toContain('<a href="https://x.io/?track=t"');
  });

  it("console provider marks rows SIMULATED", async () => {
    const { store, rows } = memoryStore();
    const { p } = provider({ simulated: true });
    await queueAndSend(store, p, email);
    expect(rows.get("n1")!.status).toBe("SIMULATED");
  });

  it("skips duplicates by dedupeKey (double submit / repeated event)", async () => {
    const { store, rows } = memoryStore();
    const { p, send } = provider();
    await queueAndSend(store, p, email);
    expect(await queueAndSend(store, p, email)).toEqual({ queued: false });
    expect(rows.size).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("records provider errors as FAILED with a short message and never throws", async () => {
    const { store, rows } = memoryStore();
    const { p } = provider({ fail: [new EmailSendError("Resend 403: domain not verified", 403)] });
    const r = await queueAndSend(store, p, email);
    expect(r).toMatchObject({ result: "FAILED" });
    expect(rows.get("n1")).toMatchObject({ status: "FAILED", attempts: 1, lastError: "Resend 403: domain not verified", sentAt: null });
  });

  it("a claimed row cannot be claimed again (no concurrent double send)", async () => {
    const { store } = memoryStore();
    const { id } = (await store.insert(email))!;
    const now = new Date();
    expect(await store.claim(id, "fresh", now)).toBe(true);
    expect(await store.claim(id, "fresh", now)).toBe(false);
    expect(await store.claim(id, "retry", now)).toBe(false); // SENDING but not stale
    const { p, send } = provider();
    expect(await dispatchEmail(store, p, id)).toBe("SKIPPED");
    expect(send).not.toHaveBeenCalled();
  });

  it("fails rows without a recipient instead of calling the provider", async () => {
    const { store, rows } = memoryStore();
    const { p, send } = provider();
    const { id } = (await store.insert({ ...email, recipientEmail: "" }))!;
    rows.get(id)!.recipientEmail = null;
    expect(await dispatchEmail(store, p, id)).toBe("FAILED");
    expect(send).not.toHaveBeenCalled();
  });

  it("retries FAILED rows up to MAX_ATTEMPTS, then leaves them FAILED", async () => {
    const { store, rows } = memoryStore();
    const err = new EmailSendError("Resend 500: boom", 500);
    const { p, send } = provider({ fail: [err, err, err, err] });
    await queueAndSend(store, p, email);

    let s = await retryEmails(store, p, "org1");
    expect(s).toMatchObject({ attempted: 1, failed: 1 });
    s = await retryEmails(store, p, "org1");
    expect(s).toMatchObject({ attempted: 1, failed: 1 });
    expect(rows.get("n1")).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });

    s = await retryEmails(store, p, "org1");
    expect(s).toEqual({ attempted: 0, sent: 0, simulated: 0, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("a retry that succeeds marks SENT and clears the error", async () => {
    const { store, rows } = memoryStore();
    const { p } = provider({ fail: [new Error("Resend unreachable: request timed out")] });
    await queueAndSend(store, p, email);
    const s = await retryEmails(store, p, "org1", { ids: ["n1"] });
    expect(s).toMatchObject({ attempted: 1, sent: 1, skipped: 0 });
    expect(rows.get("n1")).toMatchObject({ status: "SENT", attempts: 2, lastError: null });
  });

  it("retry is scoped to the caller's organization", async () => {
    const { store, rows } = memoryStore();
    const { p } = provider({ fail: [new Error("x")] });
    await queueAndSend(store, p, { ...email, organizationId: "org2" });
    const s = await retryEmails(store, p, "org1", { ids: ["n1"] });
    expect(s).toMatchObject({ attempted: 0, skipped: 1 });
    expect(rows.get("n1")!.status).toBe("FAILED");
  });

  it("does not retry SENT or SIMULATED rows", async () => {
    const { store } = memoryStore();
    const { p } = provider();
    await queueAndSend(store, p, email);
    expect((await retryEmails(store, p, "org1")).attempted).toBe(0);
  });

  it("picks up stale PENDING (>2 min) and stuck SENDING (>5 min) rows", async () => {
    const { store, rows } = memoryStore();
    const { p } = provider();
    const a = (await store.insert({ ...email, dedupeKey: "a" }))!.id; // never dispatched
    const b = (await store.insert({ ...email, dedupeKey: "b" }))!.id; // crashed mid-send
    const t0 = rows.get(a)!.createdAt.getTime();
    await store.claim(b, "fresh", new Date(t0));

    expect(await retryEmails(store, p, "org1", { now: new Date(t0 + 60_000) })).toMatchObject({ attempted: 0 });
    expect(await retryEmails(store, p, "org1", { now: new Date(t0 + 3 * 60_000) })).toMatchObject({ attempted: 1, sent: 1 });
    expect(rows.get(a)!.status).toBe("SENT");
    expect(await retryEmails(store, p, "org1", { now: new Date(t0 + 6 * 60_000) })).toMatchObject({ attempted: 1, sent: 1 });
    expect(rows.get(b)).toMatchObject({ status: "SENT", attempts: 2 });
  });
});

describe("isRetryable / shortError", () => {
  const now = new Date("2026-10-21T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("applies the status and age rules", () => {
    expect(isRetryable({ status: "FAILED", attempts: 1, createdAt: now, sentAt: null }, now)).toBe(true);
    expect(isRetryable({ status: "FAILED", attempts: 3, createdAt: now, sentAt: null }, now)).toBe(false);
    expect(isRetryable({ status: "PENDING", attempts: 0, createdAt: ago(119_000), sentAt: null }, now)).toBe(false);
    expect(isRetryable({ status: "PENDING", attempts: 0, createdAt: ago(121_000), sentAt: null }, now)).toBe(true);
    expect(isRetryable({ status: "SENDING", attempts: 1, createdAt: ago(3_600_000), sentAt: ago(60_000) }, now)).toBe(false);
    expect(isRetryable({ status: "SENDING", attempts: 1, createdAt: ago(3_600_000), sentAt: ago(301_000) }, now)).toBe(true);
    for (const status of ["SENT", "SIMULATED", null]) {
      expect(isRetryable({ status, attempts: 0, createdAt: ago(3_600_000), sentAt: null }, now)).toBe(false);
    }
  });
  it("shortens errors and strips credentials", () => {
    expect(shortError(new Error("Authorization: Bearer re_abc12345678 failed"))).toBe("Authorization: Bearer [redacted] failed");
    expect(shortError(new Error("key re_ABCDEFGH12345 rejected"))).toBe("key [redacted] rejected");
    expect(shortError(new Error("x".repeat(1000)))).toHaveLength(300);
    expect(shortError(42)).toBe("Unknown error");
  });
});

// ── Prisma store against a mocked client ──

function mockPrisma() {
  const notification = {
    create: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  };
  return { notification, client: { notification } as unknown as Pick<PrismaClient, "notification"> };
}

describe("Prisma outbox store", () => {
  it("inserts PENDING EMAIL rows with org, null user and dedupe key", async () => {
    const { notification, client } = mockPrisma();
    notification.create.mockResolvedValue({ id: "n1" });
    const store = createPrismaOutboxStore(client);
    await expect(store.insert(email)).resolves.toEqual({ id: "n1" });
    expect(notification.create.mock.calls[0][0].data).toMatchObject({
      organizationId: "org1",
      userId: null,
      channel: "EMAIL",
      status: "PENDING",
      title: email.subject,
      body: email.text,
      recipientEmail: "c@x.com",
      dedupeKey: email.dedupeKey,
    });
  });

  it("returns null on a dedupeKey unique violation and rethrows anything else", async () => {
    const { notification, client } = mockPrisma();
    const store = createPrismaOutboxStore(client);
    notification.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002", meta: { target: ["dedupeKey"] } }));
    await expect(store.insert(email)).resolves.toBeNull();
    notification.create.mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "P2003" }));
    await expect(store.insert(email)).rejects.toThrow("fk");
  });

  it("claims with a conditional updateMany (fresh: PENDING only; retry: retryable set)", async () => {
    const { notification, client } = mockPrisma();
    const store = createPrismaOutboxStore(client);
    const now = new Date("2026-10-21T10:00:00Z");

    expect(await store.claim("n1", "fresh", now)).toBe(true);
    expect(notification.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "n1", channel: "EMAIL", status: "PENDING", attempts: { lt: MAX_ATTEMPTS } },
      data: { status: "SENDING", attempts: { increment: 1 }, sentAt: now },
    });

    notification.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await store.claim("n1", "retry", now)).toBe(false);
    const where = notification.updateMany.mock.calls[1][0].where;
    expect(where).toMatchObject({ id: "n1", channel: "EMAIL", attempts: { lt: MAX_ATTEMPTS } });
    expect(where.OR).toEqual([
      { status: "FAILED" },
      { status: "PENDING", createdAt: { lt: new Date("2026-10-21T09:58:00Z") } },
      { status: "SENDING", sentAt: { lt: new Date("2026-10-21T09:55:00Z") } },
      { status: "SENDING", sentAt: null, createdAt: { lt: new Date("2026-10-21T09:55:00Z") } },
    ]);
  });

  it("only finalizes rows that are still SENDING", async () => {
    const { notification, client } = mockPrisma();
    const store = createPrismaOutboxStore(client);
    const now = new Date();
    await store.markSent("n1", "msg_1", now);
    await store.markFailed("n1", "boom");
    expect(notification.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "n1", status: "SENDING" },
      data: { status: "SENT", sentAt: now, providerMessageId: "msg_1", lastError: null },
    });
    expect(notification.updateMany.mock.calls[1][0]).toEqual({
      where: { id: "n1", status: "SENDING" },
      data: { status: "FAILED", sentAt: null, lastError: "boom" },
    });
  });

  it("findRetryable scopes by organization and optional ids", async () => {
    const { notification, client } = mockPrisma();
    notification.findMany.mockResolvedValue([{ id: "n2" }]);
    const store = createPrismaOutboxStore(client);
    expect(await store.findRetryable("org1", new Date(), ["n2", "n9"])).toEqual(["n2"]);
    expect(notification.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: "org1",
      channel: "EMAIL",
      id: { in: ["n2", "n9"] },
    });
  });

  it("get maps the row and the organization name", async () => {
    const { notification, client } = mockPrisma();
    notification.findUnique.mockResolvedValue({ id: "n1", recipientEmail: "c@x.com", title: "S", body: "B", organization: { name: "Acme" } });
    const store = createPrismaOutboxStore(client);
    expect(await store.get("n1")).toEqual({ id: "n1", recipientEmail: "c@x.com", subject: "S", text: "B", companyName: "Acme" });
  });
});
