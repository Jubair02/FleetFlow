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
  delivery: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { resetEmailProviderForTests } from "@/lib/email";
import { trackingUrl } from "@/lib/email/templates";
import { notifyAdmins, sendCustomerOutcomeEmail, sendCustomerTrackingEmail } from "@/lib/notify";
import { resetSmsProviderForTests } from "@/lib/sms";

const delivery = {
  id: "d1",
  trackingCode: "FF-AB12",
  trackingToken: "tok123",
  recipientName: "Karim",
  recipientEmail: "karim@example.com",
  recipientPhone: "017-1234-5678",
};
const tracking = {
  organizationId: "org1",
  deliveryId: "d1",
  trackingCode: "FF-AB12",
  trackingToken: "tok123",
  recipientName: "Karim",
  recipientEmail: "karim@example.com",
};

const rows = () => db.notification.create.mock.calls.map((c) => c[0].data);
const smsRows = () => rows().filter((r) => r.channel === "SMS");
const onPlan = (features: string[]) => db.organization.findUnique.mockResolvedValue({ name: "Rahman Traders", planRecord: { features } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("EMAIL_PROVIDER", "console");
  vi.stubEnv("SMS_PROVIDER", "console");
  vi.stubEnv("APP_URL", "https://app.example.com");
  resetEmailProviderForTests();
  resetSmsProviderForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  let n = 0;
  db.notification.create.mockImplementation(async () => ({ id: `n${++n}` }));
  db.notification.updateMany.mockResolvedValue({ count: 1 });
  db.notification.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const data = db.notification.create.mock.calls[Number(where.id.slice(1)) - 1][0].data;
    return { id: where.id, recipientEmail: data.recipientEmail, recipientPhone: data.recipientPhone, title: data.title, body: data.body, organization: { name: "Rahman Traders" } };
  });
  db.delivery.findUnique.mockResolvedValue({ recipientPhone: "+880 1712 345678" });
  onPlan(["customer_emails", "customer_sms"]);
});

describe("customer SMS are gated by customer_sms", () => {
  it("no SMS (and no error) when the plan lacks customer_sms", async () => {
    onPlan(["customer_emails"]);
    await sendCustomerTrackingEmail({ ...tracking, recipientPhone: "01712345678" });
    await sendCustomerOutcomeEmail({ organizationId: "org1", delivery, outcome: "DELIVERED", eventKey: "delivered:d1" });
    expect(smsRows()).toHaveLength(0);
    expect(rows().filter((r) => r.channel === "EMAIL")).toHaveLength(2);
    expect(db.delivery.findUnique).not.toHaveBeenCalled();
  });

  it("SMS without customer_emails still sends the SMS only", async () => {
    onPlan(["customer_sms"]);
    await sendCustomerTrackingEmail({ ...tracking, recipientPhone: "01712345678" });
    expect(rows().map((r) => r.channel)).toEqual(["SMS"]);
  });
});

describe("customer SMS triggers", () => {
  it("tracking: SMS row with the normalized phone, company and tracking link, then SIMULATED", async () => {
    await sendCustomerTrackingEmail({ ...tracking, recipientPhone: "01712345678" });
    const [sms] = smsRows();
    expect(sms).toMatchObject({
      organizationId: "org1",
      userId: null,
      deliveryId: "d1",
      type: "TRACKING",
      status: "PENDING",
      recipientPhone: "8801712345678",
      dedupeKey: "sms:tracking:d1:8801712345678",
    });
    expect(sms.body).toContain("Rahman Traders");
    expect(sms.body).toContain(trackingUrl("tok123"));
    expect(sms.body.length).toBeLessThanOrEqual(160);
    const smsId = `n${rows().indexOf(sms) + 1}`;
    const final = db.notification.updateMany.mock.calls.map((c) => c[0]).filter((a) => a.where.id === smsId).at(-1)!;
    expect(final.data.status).toBe("SIMULATED");
  });

  it("tracking: reads the phone from the delivery when the caller doesn't pass it", async () => {
    await sendCustomerTrackingEmail(tracking);
    expect(db.delivery.findUnique.mock.calls[0][0]).toMatchObject({ where: { id: "d1" } });
    expect(smsRows()[0].recipientPhone).toBe("8801712345678");
  });

  it("tracking: SMS goes out even without a recipient email", async () => {
    await sendCustomerTrackingEmail({ ...tracking, recipientEmail: null });
    expect(rows().map((r) => r.channel)).toEqual(["SMS"]);
  });

  it("invalid numbers are skipped silently", async () => {
    await sendCustomerTrackingEmail({ ...tracking, recipientPhone: "+1 415 555 0100" });
    expect(smsRows()).toHaveLength(0);
    expect(rows()).toHaveLength(1); // the email still goes
    await expect(sendCustomerTrackingEmail({ ...tracking, recipientEmail: null, recipientPhone: "12345" })).resolves.toBeUndefined();
    expect(rows()).toHaveLength(1);
  });

  it("delivered and failed outcomes use event-keyed dedupe keys", async () => {
    await sendCustomerOutcomeEmail({ organizationId: "org1", delivery, outcome: "DELIVERED", eventKey: "delivered:d1" });
    await sendCustomerOutcomeEmail({ organizationId: "org1", delivery, outcome: "FAILED", eventKey: "failed:ev9" });
    const [delivered, failed] = smsRows();
    expect(delivered).toMatchObject({ type: "DELIVERED", dedupeKey: "sms:delivered:d1:8801712345678" });
    expect(delivered.body).toContain("was delivered");
    expect(failed).toMatchObject({ type: "FAILED", dedupeKey: "sms:failed:ev9:8801712345678" });
    expect(failed.body).toContain("will contact you");
  });

  it("an SMS failure never breaks the customer email", async () => {
    db.delivery.findUnique.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendCustomerTrackingEmail(tracking)).resolves.toBeUndefined();
    expect(rows().map((r) => r.channel)).toEqual(["EMAIL"]);
  });
});

describe("notifyAdmins", () => {
  it("targets active admins and dispatchers", async () => {
    db.user.findMany.mockResolvedValue([]);
    await notifyAdmins("org1", { type: "POD_UPLOADED", title: "t", body: "b" });
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org1", role: { in: ["ADMIN", "DISPATCHER"] }, active: true });
  });
});
