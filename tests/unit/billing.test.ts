import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type Invoice } from "@prisma/client";

// Invoices & manual payments (src/lib/billing.ts and the /api/billing/invoices
// and /api/platform/invoices routes) with a mocked Prisma client — no database.
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  invoice: {
    findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(),
  },
  organization: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  plan: { findUnique: vi.fn(), findMany: vi.fn() },
  user: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  platformAuditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
const notify = vi.hoisted(() => ({ notifyEmail: vi.fn(), notifyInApp: vi.fn() }));
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), ...notify }));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform-auth", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-auth")>()), requirePlatformAdmin: guard }));
const requireAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), requireAdmin }));

import { ApiError } from "@/lib/api-helpers";
import {
  addBillingPeriod, invoiceYear, isPlanChange, issueDueInvoices, markInvoicePaid, nextInvoiceNumberAfter, parseInvoiceSeq,
  paymentEffects, reportPaymentSchema, requestBlockedReason, requestInvoice, resolvePaidPeriod, withInvoiceNumber,
} from "@/lib/billing";
import { getPaymentProvider, getPaymentSettings } from "@/lib/payments";
import { GET as listCompanyInvoices, POST as requestCompanyInvoice } from "@/app/api/billing/invoices/route";
import { POST as reportRoute } from "@/app/api/billing/invoices/[id]/report/route";
import { GET as printRoute } from "@/app/api/billing/invoices/[id]/print/route";
import { PATCH as patchPlatformInvoice } from "@/app/api/platform/invoices/[id]/route";

const d = (iso: string) => new Date(iso);
const NOW = d("2026-10-29T06:00:00.000Z");

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv1", organizationId: "org1", number: "FF-2026-00001", planCode: "growth", planName: "Growth", billingCycle: "MONTHLY",
    periodStart: d("2026-11-01T00:00:00.000Z"), periodEnd: d("2026-12-01T00:00:00.000Z"), amountBdt: 4000, status: "OPEN",
    issuedAt: NOW, dueAt: d("2026-11-01T00:00:00.000Z"), paidAt: null, paymentMethod: null, paymentRef: null, recordedById: null,
    recordedByName: null, reportedAt: null, reportedMethod: null, reportedRef: null, reportedById: null, reportedByName: null,
    voidReason: null, notes: null, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

const org = (over: Record<string, unknown> = {}) => ({
  id: "org1", name: "Acme", status: "ACTIVE", plan: "growth", billingCycle: "MONTHLY", subscriptionStatus: "ACTIVE",
  subscriptionPriceBdt: 4000, paidUntil: d("2026-11-01T00:00:00.000Z"), trialEndsAt: null, timezone: "Asia/Dhaka", ...over,
});

const p2002 = (target: string[]) => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6", meta: { target } });

const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => unknown) => fn(db));
  db.$queryRaw.mockResolvedValue([{ id: "org1" }]);
  db.user.findMany.mockResolvedValue([]);
  db.invoice.findFirst.mockResolvedValue(null);
  guard.mockResolvedValue({ id: "pa1", name: "Root", mustChangePassword: false });
  requireAdmin.mockResolvedValue({ id: "u1", name: "Owner", role: "ADMIN", organizationId: "org1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("period math", () => {
  it("adds a month, clamping to the month's last day", () => {
    expect(addBillingPeriod(d("2026-01-31T00:00:00.000Z"), "MONTHLY").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addBillingPeriod(d("2028-01-31T00:00:00.000Z"), "MONTHLY").toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(addBillingPeriod(d("2026-03-31T10:15:00.000Z"), "MONTHLY").toISOString()).toBe("2026-04-30T10:15:00.000Z");
    expect(addBillingPeriod(d("2026-12-15T00:00:00.000Z"), "MONTHLY").toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  it("adds a year, clamping 29 Feb", () => {
    expect(addBillingPeriod(d("2026-10-29T06:00:00.000Z"), "ANNUAL").toISOString()).toBe("2027-10-29T06:00:00.000Z");
    expect(addBillingPeriod(d("2028-02-29T00:00:00.000Z"), "ANNUAL").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });

  it("keeps a continuation's period and restarts a provisional one on the payment date", () => {
    const renewal = invoice();
    expect(resolvePaidPeriod(renewal, renewal.periodStart, d("2026-11-03T00:00:00.000Z"))).toMatchObject({ restarted: false, start: renewal.periodStart });
    // starts after the payment → kept even without a matching paidUntil
    expect(resolvePaidPeriod(renewal, null, d("2026-10-30T00:00:00.000Z")).restarted).toBe(false);
    const upgrade = invoice({ periodStart: d("2026-10-20T00:00:00.000Z"), periodEnd: d("2026-11-20T00:00:00.000Z") });
    const paidAt = d("2026-10-29T06:00:00.000Z");
    const p = resolvePaidPeriod(upgrade, null, paidAt);
    expect(p).toEqual({ start: paidAt, end: d("2026-11-29T06:00:00.000Z"), restarted: true });
  });
});

describe("invoice numbering", () => {
  it("is sequential per year and zero-padded", () => {
    expect(nextInvoiceNumberAfter(null, 2026)).toBe("FF-2026-00001");
    expect(nextInvoiceNumberAfter("FF-2026-00041", 2026)).toBe("FF-2026-00042");
    expect(nextInvoiceNumberAfter("FF-2026-99999", 2026)).toBe("FF-2026-100000");
    expect(parseInvoiceSeq("FF-2025-00007", 2026)).toBeNull();
  });

  it("uses the Asia/Dhaka year", () => {
    expect(invoiceYear(d("2026-12-31T17:59:00.000Z"))).toBe(2026);
    expect(invoiceYear(d("2026-12-31T18:00:00.000Z"))).toBe(2027);
  });

  it("retries with a fresh number when another request took it, but not on other conflicts", async () => {
    db.invoice.findFirst.mockResolvedValueOnce({ number: "FF-2026-00004" }).mockResolvedValueOnce({ number: "FF-2026-00005" });
    const tried: string[] = [];
    const result = await withInvoiceNumber(NOW, async (n) => {
      tried.push(n);
      if (tried.length === 1) throw p2002(["number"]);
      return n;
    });
    expect(tried).toEqual(["FF-2026-00005", "FF-2026-00006"]);
    expect(result).toBe("FF-2026-00006");

    await expect(withInvoiceNumber(NOW, async () => Promise.reject(p2002(["organizationId", "periodStart"])))).rejects.toThrow();
    expect(db.invoice.findFirst).toHaveBeenCalledTimes(3);
  });
});

describe("issueDueInvoices (cron)", () => {
  const dueOrg = { id: "org1", plan: "growth", billingCycle: "MONTHLY", subscriptionPriceBdt: 3500, paidUntil: d("2026-11-01T00:00:00.000Z"), planRecord: { name: "Growth" } };

  beforeEach(() => {
    db.organization.findMany.mockResolvedValue([dueOrg]);
    db.invoice.findMany.mockResolvedValue([]); // nothing overdue
    db.invoice.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new", ...data }));
  });

  it("only looks at paid, unsuspended ACTIVE/PAST_DUE organizations whose period ends within 7 days", async () => {
    await issueDueInvoices(NOW);
    const where = db.organization.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: "ACTIVE", subscriptionStatus: { in: ["ACTIVE", "PAST_DUE"] }, subscriptionPriceBdt: { gt: 0 } });
    expect(where.paidUntil.lte.toISOString()).toBe("2026-11-05T06:00:00.000Z");
    // paidUntil: null never matches a range filter → ACTIVE without paidUntil is never auto-invoiced
    expect(where.paidUntil.gte).toBeInstanceOf(Date);
  });

  it("issues the next period once: periodStart = due = paidUntil, at the agreed price", async () => {
    db.invoice.findUnique.mockResolvedValue(null);
    const s = await issueDueInvoices(NOW);
    expect(s).toMatchObject({ due: 1, issued: 1, alreadyIssued: 0, failed: 0 });
    const data = db.invoice.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ organizationId: "org1", number: "FF-2026-00001", planCode: "growth", planName: "Growth", amountBdt: 3500, billingCycle: "MONTHLY" });
    expect(data.periodStart).toEqual(dueOrg.paidUntil);
    expect(data.dueAt).toEqual(dueOrg.paidUntil);
    expect(data.periodEnd.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("is idempotent: an existing invoice for the period (or a concurrent insert) is not issued again", async () => {
    db.invoice.findUnique.mockResolvedValue({ id: "existing" });
    expect(await issueDueInvoices(NOW)).toMatchObject({ issued: 0, alreadyIssued: 1 });
    expect(db.invoice.create).not.toHaveBeenCalled();

    db.invoice.findUnique.mockResolvedValue(null);
    db.invoice.create.mockRejectedValueOnce(p2002(["organizationId", "periodStart"]));
    expect(await issueDueInvoices(NOW)).toMatchObject({ issued: 0, alreadyIssued: 1, failed: 0 });
  });

  it("marks ACTIVE → PAST_DUE for an overdue unreported invoice once paidUntil has passed", async () => {
    db.organization.findMany.mockResolvedValue([]);
    db.invoice.findMany.mockResolvedValue([{ organizationId: "org1", number: "FF-2026-00001" }]);
    db.organization.updateMany.mockResolvedValue({ count: 1 });
    const s = await issueDueInvoices(NOW);
    expect(s.markedPastDue).toBe(1);
    expect(db.invoice.findMany.mock.calls[0][0].where).toMatchObject({ status: "OPEN", reportedAt: null, organization: { subscriptionStatus: "ACTIVE" } });
    expect(db.organization.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "org1", subscriptionStatus: "ACTIVE" }, data: { subscriptionStatus: "PAST_DUE" } });
    expect(db.platformAuditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe("marking an invoice paid", () => {
  it("renewal: extends paidUntil to the period end, keeps the plan", () => {
    const fx = paymentEffects(invoice(), org(), d("2026-10-30T00:00:00.000Z"));
    expect(fx.planChange).toBe(false);
    expect(fx.orgData).toEqual({ subscriptionStatus: "ACTIVE", paidUntil: d("2026-12-01T00:00:00.000Z") });
  });

  it("never shortens paidUntil", () => {
    const fx = paymentEffects(invoice(), org({ paidUntil: d("2027-01-01T00:00:00.000Z") }), NOW);
    expect(fx.paidUntil.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("trial upgrade: starts on the payment date and applies plan, cycle and price", () => {
    const inv = invoice({ planCode: "growth", billingCycle: "ANNUAL", amountBdt: 40000, periodStart: d("2026-10-20T00:00:00.000Z"), periodEnd: d("2027-10-20T00:00:00.000Z") });
    const trial = org({ plan: "trial", subscriptionStatus: "TRIAL", subscriptionPriceBdt: null, paidUntil: null });
    expect(isPlanChange(inv, trial)).toBe(true);
    const fx = paymentEffects(inv, trial, NOW);
    expect(fx.orgData).toEqual({
      subscriptionStatus: "ACTIVE", paidUntil: d("2027-10-29T06:00:00.000Z"),
      plan: "growth", billingCycle: "ANNUAL", subscriptionPriceBdt: 40000, planAssignedAt: NOW,
    });
  });

  it("writes invoice, organization and both audit rows in one transaction", async () => {
    db.invoice.findUnique.mockResolvedValue({ organizationId: "org1" });
    db.organization.findUniqueOrThrow.mockResolvedValue(org());
    db.invoice.findFirst.mockResolvedValue(invoice());
    db.invoice.update.mockImplementation(async ({ data }: { data: Partial<Invoice> }) => invoice({ ...data }));
    const paid = await markInvoicePaid({ id: "pa1", name: "Root" }, "inv1", { method: "BKASH", reference: "8N7A6B" }, "1.2.3.4", NOW);
    expect(paid.status).toBe("PAID");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.invoice.update.mock.calls[0][0].data).toMatchObject({ status: "PAID", paymentMethod: "BKASH", paymentRef: "8N7A6B", recordedById: "pa1", paidAt: NOW });
    expect(db.organization.update).toHaveBeenCalledWith({ where: { id: "org1" }, data: { subscriptionStatus: "ACTIVE", paidUntil: d("2026-12-01T00:00:00.000Z") } });
    expect(db.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: "INVOICE_PAID", targetType: "Invoice", organizationId: "org1", actorId: "pa1", ip: "1.2.3.4" });
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "INVOICE_PAID", organizationId: "org1", actorName: "FleetFlow support" });
  });

  it("refuses an invoice that isn't OPEN (409) and a future payment date (400)", async () => {
    db.invoice.findUnique.mockResolvedValue({ organizationId: "org1" });
    db.organization.findUniqueOrThrow.mockResolvedValue(org());
    db.invoice.findFirst.mockResolvedValue(invoice({ status: "PAID" }));
    await expect(markInvoicePaid(null, "inv1", { method: "BANK" }, null, NOW)).rejects.toMatchObject({ status: 409 });
    await expect(markInvoicePaid(null, "inv1", { method: "BANK", paidAt: d("2026-11-15T00:00:00.000Z") }, null, NOW)).rejects.toMatchObject({ status: 400 });
    expect(db.organization.update).not.toHaveBeenCalled();
  });

  it("platform route: mobile money needs a transaction ID; void needs a reason", async () => {
    const r1 = await patchPlatformInvoice(json({ action: "mark-paid", method: "NAGAD" }, "PATCH"), params("inv1"));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/Nagad transaction ID/);
    const r2 = await patchPlatformInvoice(json({ action: "void", reason: "" }, "PATCH"), params("inv1"));
    expect(r2.status).toBe(400);
    guard.mockRejectedValueOnce(new ApiError(401, "Platform authentication required"));
    expect((await patchPlatformInvoice(json({ action: "void", reason: "wrong amount" }, "PATCH"), params("inv1"))).status).toBe(401);
  });
});

describe("self-service invoice request", () => {
  it("is only for trial, cancelled or lapsed subscriptions", () => {
    expect(requestBlockedReason(org({ subscriptionStatus: "TRIAL", paidUntil: null }), NOW)).toBeNull();
    expect(requestBlockedReason(org({ subscriptionStatus: "CANCELLED" }), NOW)).toBeNull();
    expect(requestBlockedReason(org({ subscriptionStatus: "PAST_DUE", paidUntil: d("2026-10-01T00:00:00.000Z") }), NOW)).toBeNull();
    expect(requestBlockedReason(org(), NOW)).toMatch(/paid up/);
    expect(requestBlockedReason(org({ paidUntil: null }), NOW)).toMatch(/managed by FleetFlow/);
    expect(requestBlockedReason(org({ subscriptionStatus: "TRIAL", status: "SUSPENDED" }), NOW)).toMatch(/suspended/);
  });

  const trialOrg = org({ plan: "trial", subscriptionStatus: "TRIAL", subscriptionPriceBdt: null, paidUntil: null });
  const growth = { code: "growth", name: "Growth", monthlyPriceBdt: 4000, annualPriceBdt: 40000, active: true, isPublic: true };

  it("voids the previous open invoice and creates one at list price with a provisional period", async () => {
    db.organization.findUniqueOrThrow.mockResolvedValue(trialOrg);
    db.plan.findUnique.mockResolvedValue(growth);
    db.invoice.findMany.mockResolvedValue([{ id: "old", number: "FF-2026-00003", reportedAt: null }]);
    db.invoice.findFirst.mockResolvedValue({ number: "FF-2026-00003" });
    db.invoice.create.mockImplementation(async ({ data }: { data: Partial<Invoice> }) => invoice({ id: "new", ...data }));
    const inv = await requestInvoice({ id: "u1", name: "Owner", organizationId: "org1" }, { planCode: "growth", billingCycle: "ANNUAL" }, NOW);
    expect(db.invoice.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["old"] }, status: "OPEN" }, data: { status: "VOID", voidReason: "Replaced by FF-2026-00004" } });
    expect(inv).toMatchObject({ number: "FF-2026-00004", amountBdt: 40000, billingCycle: "ANNUAL", periodStart: NOW });
    expect(inv.dueAt.toISOString()).toBe("2026-11-05T06:00:00.000Z");
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "INVOICE_REQUESTED", actorId: "u1" });
  });

  it("refuses while a reported payment is being verified, and for a running paid subscription", async () => {
    db.organization.findUniqueOrThrow.mockResolvedValue(trialOrg);
    db.plan.findUnique.mockResolvedValue(growth);
    db.invoice.findMany.mockResolvedValue([{ id: "old", number: "FF-2026-00003", reportedAt: NOW }]);
    await expect(requestInvoice({ id: "u1", name: "Owner", organizationId: "org1" }, { planCode: "growth", billingCycle: "MONTHLY" }, NOW)).rejects.toMatchObject({ status: 409 });

    db.organization.findUniqueOrThrow.mockResolvedValue(org({ paidUntil: d("2027-01-01T00:00:00.000Z") }));
    const res = await requestCompanyInvoice(json({ planCode: "growth", billingCycle: "MONTHLY" }));
    expect(res.status).toBe(409);
    expect(db.invoice.create).not.toHaveBeenCalled();
  });

  it("rejects hidden/inactive plans", async () => {
    db.organization.findUniqueOrThrow.mockResolvedValue(trialOrg);
    db.plan.findUnique.mockResolvedValue({ ...growth, code: "secret", isPublic: false });
    const res = await requestCompanyInvoice(json({ planCode: "secret", billingCycle: "MONTHLY" }));
    expect(res.status).toBe(400);
  });
});

describe("tenant isolation of the company invoice routes", () => {
  it("lists only the caller's organization", async () => {
    db.organization.findUnique.mockResolvedValue(org());
    db.invoice.findMany.mockResolvedValue([invoice()]);
    db.plan.findMany.mockResolvedValue([]);
    const res = await listCompanyInvoices();
    expect(res.status).toBe(200);
    expect(db.invoice.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
    expect(db.organization.findUnique.mock.calls[0][0].where).toEqual({ id: "org1" });
    const body = await res.json();
    expect(body.openInvoice.number).toBe("FF-2026-00001");
    expect(body.openInvoice.instructions.reference).toBe("FF-2026-00001");
  });

  it("can't report a payment on another organization's invoice", async () => {
    db.invoice.findFirst.mockResolvedValue(null); // scoped lookup misses
    const res = await reportRoute(json({ method: "BKASH", reference: "TX1" }), params("other-org-invoice"));
    expect(res.status).toBe(404);
    expect(db.invoice.findFirst.mock.calls[0][0].where).toEqual({ id: "other-org-invoice", organizationId: "org1" });
    expect(db.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("reports a payment on its own invoice (bKash needs a TrxID)", async () => {
    expect((await reportRoute(json({ method: "BKASH" }), params("inv1"))).status).toBe(400);
    db.invoice.findFirst.mockResolvedValue(invoice());
    db.invoice.updateMany.mockResolvedValue({ count: 1 });
    db.invoice.findUniqueOrThrow.mockResolvedValue(invoice({ reportedAt: NOW, reportedMethod: "BKASH", reportedRef: "TX1" }));
    const res = await reportRoute(json({ method: "BKASH", reference: " TX1 " }), params("inv1"));
    expect(res.status).toBe(200);
    expect(db.invoice.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "inv1", organizationId: "org1", status: "OPEN" },
      data: { reportedMethod: "BKASH", reportedRef: "TX1", reportedById: "u1", reportedByName: "Owner" },
    });
  });

  it("print view is scoped to the caller's organization", async () => {
    const miss = await printRoute(new Request("http://localhost/x"), params("other"));
    expect(miss.status).toBe(404);
    expect(db.invoice.findFirst.mock.calls[0][0].where).toEqual({ id: "other", organizationId: "org1" });

    db.invoice.findFirst.mockResolvedValue({ ...invoice({ notes: "<script>x</script>" }), organization: { name: "Acme & Co", address: null, contactEmail: null, phone: null, timezone: "Asia/Dhaka", paidUntil: null } });
    const hit = await printRoute(new Request("http://localhost/x"), params("inv1"));
    expect(hit.headers.get("content-type")).toMatch(/text\/html/);
    const html = await hit.text();
    expect(html).toContain("FF-2026-00001");
    expect(html).toContain("Acme &amp; Co");
    expect(html).not.toContain("<script>x</script>");
  });

  it("dispatchers (non-admins) are refused", async () => {
    requireAdmin.mockRejectedValue(new ApiError(403, "Admin access required"));
    expect((await listCompanyInvoices()).status).toBe(403);
    expect((await reportRoute(json({ method: "CASH" }), params("inv1"))).status).toBe(403);
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe("payments", () => {
  it("manual provider shows the configured accounts with the invoice number as reference", () => {
    const settings = getPaymentSettings({ PAYMENT_BKASH_NUMBER: " 01700000000 ", PAYMENT_BANK_DETAILS: "Acme Bank\\nA/C 123" });
    expect(settings).toEqual({ bkashNumber: "01700000000", nagadNumber: null, rocketNumber: null, bankDetails: "Acme Bank\nA/C 123" });
    const ins = getPaymentProvider({}).instructions(invoice(), settings);
    expect(ins.provider).toBe("manual");
    expect(ins.reference).toBe("FF-2026-00001");
    expect(ins.accounts.map((a) => a.label)).toEqual(["bKash", "Bank transfer"]);
    expect(ins.steps[0]).toContain("৳4,000");
  });

  it("falls back to manual for an unknown provider", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPaymentProvider({ PAYMENT_PROVIDER: "sslcommerz" }).id).toBe("manual");
  });

  it("reportPaymentSchema requires a reference for mobile money only", () => {
    expect(reportPaymentSchema.safeParse({ method: "ROCKET" }).success).toBe(false);
    expect(reportPaymentSchema.safeParse({ method: "CASH" }).success).toBe(true);
    expect(reportPaymentSchema.safeParse({ method: "PAYPAL", reference: "x" }).success).toBe(false);
  });
});
