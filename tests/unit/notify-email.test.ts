import { beforeEach, describe, expect, it, vi } from "vitest";

// notify.ts talks to Prisma through "@/lib/db" — replace it with a mock (no DB access).
const db = vi.hoisted(() => ({
  notification: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  organization: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { resetEmailProviderForTests } from "@/lib/email";
import { notifyAdmins, sendCustomerOutcomeEmail, sendCustomerTrackingEmail } from "@/lib/notify";

const delivery = {
  id: "d1",
  trackingCode: "FF-AB12",
  trackingToken: "tok123",
  recipientName: "Karim",
  recipientEmail: "Karim@Example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("EMAIL_PROVIDER", "console");
  vi.stubEnv("APP_URL", "https://app.example.com");
  resetEmailProviderForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  let n = 0;
  db.notification.create.mockImplementation(async () => ({ id: `n${++n}` }));
  db.notification.updateMany.mockResolvedValue({ count: 1 });
  db.notification.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const call = db.notification.create.mock.calls[Number(where.id.slice(1)) - 1][0].data;
    return { id: where.id, recipientEmail: call.recipientEmail, title: call.title, body: call.body, organization: { name: "Rahman Traders" } };
  });
  db.organization.findUnique.mockResolvedValue({ name: "Rahman Traders", planRecord: { features: ["customer_emails"] } });
});

describe("customer emails", () => {
  it("tracking email: no-op without a recipient email", async () => {
    await sendCustomerTrackingEmail({ organizationId: "org1", deliveryId: "d1", trackingCode: "FF-AB12", trackingToken: "t", recipientName: "K", recipientEmail: null });
    await sendCustomerTrackingEmail({ organizationId: "org1", deliveryId: "d1", trackingCode: "FF-AB12", trackingToken: "t", recipientName: "K", recipientEmail: "  " });
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("tracking email: customer row (no user) with the public link, then SIMULATED in console mode", async () => {
    await sendCustomerTrackingEmail({ organizationId: "org1", deliveryId: "d1", trackingCode: "FF-AB12", trackingToken: "tok123", recipientName: "Karim", recipientEmail: "Karim@Example.com" });
    const data = db.notification.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: "org1",
      userId: null,
      deliveryId: "d1",
      channel: "EMAIL",
      status: "PENDING",
      type: "TRACKING",
      recipientEmail: "Karim@Example.com",
      dedupeKey: "customer-tracking:d1:karim@example.com",
    });
    expect(data.body).toContain("https://app.example.com/?track=tok123");
    const last = db.notification.updateMany.mock.calls.at(-1)![0];
    expect(last.data.status).toBe("SIMULATED");
  });

  it("delivered email uses the delivered subject and event key", async () => {
    await sendCustomerOutcomeEmail({ organizationId: "org1", delivery, outcome: "DELIVERED", eventKey: "delivered:d1" });
    const data = db.notification.create.mock.calls[0][0].data;
    expect(data.title).toBe("Your delivery FF-AB12 was delivered");
    expect(data.dedupeKey).toBe("customer-delivered:d1:karim@example.com");
  });

  it("failed email is neutral and keyed by the failure event", async () => {
    await sendCustomerOutcomeEmail({ organizationId: "org1", delivery, outcome: "FAILED", eventKey: "failed:ev9" });
    const data = db.notification.create.mock.calls[0][0].data;
    expect(data.type).toBe("FAILED");
    expect(data.body).toContain("will contact you");
    expect(data.dedupeKey).toBe("customer-failed:ev9:karim@example.com");
  });

  it("a duplicate event (P2002 on dedupeKey) is skipped without sending", async () => {
    db.notification.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002", meta: { target: ["dedupeKey"] } }));
    await expect(sendCustomerOutcomeEmail({ organizationId: "org1", delivery, outcome: "DELIVERED", eventKey: "delivered:d1" })).resolves.toBeUndefined();
    expect(db.notification.updateMany).not.toHaveBeenCalled();
  });
});

describe("customer emails are a plan feature", () => {
  it("are skipped silently (no row, no error) when the plan lacks customer_emails", async () => {
    db.organization.findUnique.mockResolvedValue({ name: "Rahman Traders", planRecord: { features: ["csv_import"] } });
    await expect(
      sendCustomerTrackingEmail({ organizationId: "org1", deliveryId: "d1", trackingCode: "FF-AB12", trackingToken: "t", recipientName: "K", recipientEmail: "k@x.com" })
    ).resolves.toBeUndefined();
    await expect(sendCustomerOutcomeEmail({ organizationId: "org1", delivery, outcome: "DELIVERED", eventKey: "delivered:d1" })).resolves.toBeUndefined();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("checks the organization's own plan", async () => {
    await sendCustomerOutcomeEmail({ organizationId: "org7", delivery, outcome: "FAILED", eventKey: "failed:e1" });
    expect(db.organization.findUnique.mock.calls[0][0].where).toEqual({ id: "org7" });
    expect(db.notification.create).toHaveBeenCalledTimes(1);
  });

  it("staff/admin notifications are not gated", async () => {
    db.organization.findUnique.mockResolvedValue({ name: "Rahman Traders", planRecord: { features: [] } });
    db.user.findMany.mockResolvedValue([{ id: "a1", email: "a1@x.com" }]);
    await notifyAdmins("org1", { type: "DELIVERED", title: "t", body: "b", deliveryId: "d1" }, { email: true, emailDedupeKey: "delivered:d1" });
    expect(db.notification.create.mock.calls.map((c) => c[0].data.channel).sort()).toEqual(["EMAIL", "IN_APP"]);
  });
});

describe("notifyAdmins", () => {
  it("creates in-app rows and, with email, deduped email rows per admin", async () => {
    db.user.findMany.mockResolvedValue([{ id: "a1", email: "a1@x.com" }, { id: "a2", email: "a2@x.com" }]);
    await notifyAdmins("org1", { type: "DELIVERED", title: "Delivery completed", body: "FF-1 delivered", deliveryId: "d1" }, { email: true, emailDedupeKey: "delivered:d1" });
    const rows = db.notification.create.mock.calls.map((c) => c[0].data);
    expect(rows.filter((r) => r.channel === "IN_APP")).toHaveLength(2);
    const emails = rows.filter((r) => r.channel === "EMAIL");
    expect(emails.map((r) => r.dedupeKey).sort()).toEqual(["delivered:d1:a1", "delivered:d1:a2"]);
    expect(emails[0]).toMatchObject({ organizationId: "org1", status: "PENDING", title: "[FleetFlow] Delivery completed" });
  });

  it("without email only creates in-app rows", async () => {
    db.user.findMany.mockResolvedValue([{ id: "a1", email: "a1@x.com" }]);
    await notifyAdmins("org1", { type: "POD_UPLOADED", title: "t", body: "b" });
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create.mock.calls[0][0].data.channel).toBe("IN_APP");
  });
});
