import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/cron/outbox — Prisma is mocked (no DB).
const db = vi.hoisted(() => ({
  notification: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  webhookDelivery: { findMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));

import { GET } from "@/app/api/cron/outbox/route";
import { resetEmailProviderForTests } from "@/lib/email";
import { resetSmsProviderForTests } from "@/lib/sms";

const SECRET = "cron-secret-0123456789";
const call = (auth?: string) =>
  GET(new Request("http://localhost/api/cron/outbox", { headers: auth === undefined ? {} : { authorization: auth } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("EMAIL_PROVIDER", "console");
  vi.stubEnv("SMS_PROVIDER", "console");
  resetEmailProviderForTests();
  resetSmsProviderForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  db.notification.findMany.mockResolvedValue([]);
  db.notification.updateMany.mockResolvedValue({ count: 1 });
  db.webhookDelivery.findMany.mockResolvedValue([]);
  db.webhookDelivery.deleteMany.mockResolvedValue({ count: 0 });
});

describe("GET /api/cron/outbox auth", () => {
  it("503 when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(db.notification.findMany).not.toHaveBeenCalled();
  });

  it("401 without, or with a wrong, Authorization header", async () => {
    for (const auth of [undefined, "", SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, `Basic ${SECRET}`, "Bearer "]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
    }
    expect(db.notification.findMany).not.toHaveBeenCalled();
  });

  it("200 with counts only when the secret matches", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true, attempted: 0, sent: 0, simulated: 0, failed: 0, skipped: 0,
      webhooks: { attempted: 0, succeeded: 0, retrying: 0, failed: 0, skipped: 0, pruned: 0 },
    });
    const where = db.notification.findMany.mock.calls[0][0].where;
    expect(where.channel).toEqual({ in: ["EMAIL", "SMS"] });
    expect(db.notification.findMany.mock.calls[0][0].take).toBe(50);
  });
});

describe("GET /api/cron/outbox retries", () => {
  it("re-dispatches due email and SMS rows through their own providers", async () => {
    db.notification.findMany.mockResolvedValue([
      { id: "e1", channel: "EMAIL" },
      { id: "s1", channel: "SMS" },
    ]);
    db.notification.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "e1"
        ? { id: "e1", recipientEmail: "c@x.com", title: "S", body: "B", organization: { name: "Acme" } }
        : { id: "s1", recipientPhone: "8801712345678", body: "Hi" }
    );
    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toMatchObject({ success: true, attempted: 2, sent: 0, simulated: 2, failed: 0, skipped: 0 });
    const claims = db.notification.updateMany.mock.calls.map((c) => c[0]).filter((a) => a.data.status === "SENDING");
    expect(claims.map((a) => [a.where.id, a.where.channel]).sort()).toEqual([
      ["e1", "EMAIL"],
      ["s1", "SMS"],
    ]);
    expect(claims[0].data.lastAttemptAt).toBeInstanceOf(Date);
  });

  it("a row someone else already claimed is skipped", async () => {
    db.notification.findMany.mockResolvedValue([{ id: "s1", channel: "SMS" }]);
    db.notification.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toMatchObject({ attempted: 1, skipped: 1 });
    expect(db.notification.findUnique).not.toHaveBeenCalled();
  });
});
