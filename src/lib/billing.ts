import { z } from "zod";
import { Prisma, type Invoice, type PlatformAdmin } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { table, TX_OPTIONS } from "@/lib/delivery";
import { auditData, bestEffort, notifyEmail, notifyInApp } from "@/lib/notify";
import { platformAuditData } from "@/lib/platform-auth";
import { listPrice, type BillingCycle } from "@/lib/plan-catalog";
import { getPaymentProvider, getPaymentSettings } from "@/lib/payments";
import { invoiceIssuedEmail, invoicePaidEmail, invoicePaymentReportedEmail } from "@/lib/email/templates";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import {
  MOBILE_MONEY_METHODS, PAYMENT_METHODS, paymentMethodLabel,
  type InvoiceRow, type InvoiceStatus, type PaymentInstructions, type PaymentMethod, type PlatformInvoiceRow,
} from "@/lib/billing-types";

// ─────────────────────────────────────────────────────────────
// Invoices & manual payments (server only). Lifecycle (docs/BILLING.md §0):
//
//   issue (cron renewal / company "Request invoice" / platform admin)
//     → OPEN ──(company reports "I've paid": reported*)──┐
//         │                                              ▼
//         ├── platform admin marks PAID → paidUntil extended, status ACTIVE
//         └── platform admin VOIDs (reason)
//
// Rules chosen:
//  • Renewals: the daily cron issues the NEXT period's invoice for paid
//    organizations (price > 0, ACTIVE/PAST_DUE, not suspended) whose paidUntil
//    is within INVOICE_LEAD_DAYS (or lapsed less than LAPSED_LOOKBACK_DAYS ago):
//    periodStart = paidUntil, dueAt = paidUntil. The (organizationId,
//    periodStart) unique key makes it exactly-once.
//  • ACTIVE organizations without paidUntil are open-ended manual deals: never
//    auto-invoiced (a platform admin issues invoices by hand; once one is paid
//    paidUntil is set and renewals start).
//  • Period on payment: an invoice that continues the current paid period
//    (periodStart == paidUntil) or starts after the payment keeps its dates.
//    Anything else (new subscription, plan change, reactivation) is
//    provisional and restarts on the payment date — the customer never pays
//    for days before they paid.
//  • Plan change: an invoice whose plan or cycle differs from the organization's
//    (or any invoice while on TRIAL) switches the organization to that plan and
//    cycle when paid, snapshotting the invoice amount as the agreed price.
//  • Paid: paidUntil = max(paidUntil, periodEnd), subscriptionStatus = ACTIVE —
//    in one transaction with platform + tenant audit rows.
//  • Overdue: the cron marks ACTIVE → PAST_DUE when an OPEN invoice is past
//    due AND paidUntil has passed. That is only a label: access timing (grace,
//    read-only) still comes from paidUntil in src/lib/subscription.ts, so
//    nothing is penalised twice.
// ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** Renewal invoices are issued this many days before paidUntil. */
export const INVOICE_LEAD_DAYS = 7;
/** Requested / manual invoices are due this many days after issue. */
export const INVOICE_DUE_DAYS = 7;
/** The cron still issues a renewal for a paid period that ended at most this long ago. */
export const LAPSED_LOOKBACK_DAYS = 30;
export const INVOICE_PREFIX = "FF";
const MAX_NUMBER_ATTEMPTS = 5;
/** Bangladesh has no DST: invoice years follow Asia/Dhaka (UTC+6). */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
export const MAX_INVOICE_BDT = 10_000_000;

export const BILLING_ACTOR_NAME = "FleetFlow billing";

// ── Pure helpers (unit-tested) ───────────────────────────────

/**
 * End of a billing period that starts at `start`: +1 month or +12 months,
 * same time of day, clamped to the month's last day (31 Jan → 28/29 Feb,
 * 29 Feb 2028 + 1 year → 28 Feb 2029). UTC calendar.
 */
export function addBillingPeriod(start: Date, cycle: BillingCycle): Date {
  const months = cycle === "ANNUAL" ? 12 : 1;
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds())
  );
}

export function invoiceYear(at: Date): number {
  return new Date(at.getTime() + DHAKA_OFFSET_MS).getUTCFullYear();
}

export function formatInvoiceNumber(year: number, seq: number): string {
  return `${INVOICE_PREFIX}-${year}-${String(seq).padStart(5, "0")}`;
}

/** Sequence part of an invoice number of `year`, or null if it isn't one. */
export function parseInvoiceSeq(number: string, year: number): number | null {
  const m = new RegExp(`^${INVOICE_PREFIX}-${year}-(\\d+)$`).exec(number);
  return m ? Number(m[1]) : null;
}

/** The number after `last` (the highest number issued this year, or null). Sequences restart each year. */
export function nextInvoiceNumberAfter(last: string | null, year: number): string {
  const seq = last ? parseInvoiceSeq(last, year) : null;
  return formatInvoiceNumber(year, (seq ?? 0) + 1);
}

type OrgBilling = {
  plan: string;
  billingCycle: string;
  subscriptionStatus: string;
  subscriptionPriceBdt: number | null;
  paidUntil: Date | null;
};

type InvoicePeriod = Pick<Invoice, "periodStart" | "periodEnd" | "billingCycle">;

function sameInstant(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && a.getTime() === b.getTime();
}

/** Paying this invoice moves the organization onto the invoiced plan/cycle. */
export function isPlanChange(inv: Pick<Invoice, "planCode" | "billingCycle">, org: Pick<OrgBilling, "plan" | "billingCycle" | "subscriptionStatus">): boolean {
  return org.subscriptionStatus === "TRIAL" || inv.planCode !== org.plan || inv.billingCycle !== org.billingCycle;
}

/** The period an invoice actually pays for when paid at `paidAt` (see "Period on payment" above). */
export function resolvePaidPeriod(inv: InvoicePeriod, orgPaidUntil: Date | null, paidAt: Date): { start: Date; end: Date; restarted: boolean } {
  if (sameInstant(inv.periodStart, orgPaidUntil) || inv.periodStart.getTime() >= paidAt.getTime()) {
    return { start: inv.periodStart, end: inv.periodEnd, restarted: false };
  }
  const cycle: BillingCycle = inv.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  return { start: paidAt, end: addBillingPeriod(paidAt, cycle), restarted: true };
}

/** OPEN invoice whose dates will move to the payment date. */
export function isProvisional(inv: InvoicePeriod & { status: string }, orgPaidUntil: Date | null, now: Date): boolean {
  return inv.status === "OPEN" && resolvePaidPeriod(inv, orgPaidUntil, now).restarted;
}

/** Everything marking `inv` paid at `paidAt` changes (pure; applied in markInvoicePaid). */
export function paymentEffects(inv: Pick<Invoice, "planCode" | "billingCycle" | "amountBdt"> & InvoicePeriod, org: OrgBilling, paidAt: Date) {
  const period = resolvePaidPeriod(inv, org.paidUntil, paidAt);
  const planChange = isPlanChange(inv, org);
  const paidUntil = org.paidUntil && org.paidUntil.getTime() > period.end.getTime() ? org.paidUntil : period.end;
  const orgData: Prisma.OrganizationUncheckedUpdateInput = {
    subscriptionStatus: "ACTIVE",
    paidUntil,
    ...(planChange
      ? { plan: inv.planCode, billingCycle: inv.billingCycle, subscriptionPriceBdt: inv.amountBdt, planAssignedAt: paidAt }
      : {}),
  };
  return { period, planChange, paidUntil, orgData };
}

/**
 * Self-service "Request invoice" is for companies without a running paid
 * period: on trial, cancelled, or whose paidUntil has passed. Returns why not, or null.
 */
export function requestBlockedReason(org: Pick<OrgBilling, "subscriptionStatus" | "paidUntil"> & { status: string }, now: Date): string | null {
  if (org.status !== "ACTIVE") return "This account is suspended — contact FleetFlow.";
  if (org.subscriptionStatus === "TRIAL" || org.subscriptionStatus === "CANCELLED") return null;
  if (org.paidUntil && org.paidUntil.getTime() <= now.getTime()) return null;
  if (!org.paidUntil) return "Your subscription is managed by FleetFlow — contact us to change your plan or billing cycle.";
  return "Your subscription is paid up — contact FleetFlow to change your plan or billing cycle. Renewal invoices are issued automatically.";
}

/** Amount for a requested invoice: the company's grandfathered price when renewing the same plan and cycle, else the list price. */
export function requestedAmount(
  plan: { code: string; name: string; monthlyPriceBdt: number | null; annualPriceBdt: number | null },
  cycle: BillingCycle,
  org: OrgBilling
): number {
  if (org.subscriptionStatus !== "TRIAL" && plan.code === org.plan && cycle === org.billingCycle && (org.subscriptionPriceBdt ?? 0) > 0) {
    return org.subscriptionPriceBdt!;
  }
  const price = listPrice(plan, cycle);
  if (!price || price <= 0) {
    throw new ApiError(400, `The ${plan.name} plan isn't sold ${cycle === "ANNUAL" ? "annually" : "monthly"} — choose the other billing cycle`);
  }
  return price;
}

/** True for a P2002 on the given column (e.g. "number" or "periodStart"). */
export function isUniqueViolation(e: unknown, field: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.some((t) => String(t).includes(field)) : String(target ?? "").includes(field);
}

export function toInvoiceRow(inv: Invoice, orgPaidUntil: Date | null, now = new Date()): InvoiceRow {
  return {
    id: inv.id,
    number: inv.number,
    organizationId: inv.organizationId,
    planCode: inv.planCode,
    planName: inv.planName,
    billingCycle: inv.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY",
    periodStart: inv.periodStart.toISOString(),
    periodEnd: inv.periodEnd.toISOString(),
    amountBdt: inv.amountBdt,
    status: inv.status as InvoiceStatus,
    issuedAt: inv.issuedAt.toISOString(),
    dueAt: inv.dueAt.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    paymentMethod: inv.paymentMethod,
    paymentRef: inv.paymentRef,
    reportedAt: inv.reportedAt?.toISOString() ?? null,
    reportedMethod: inv.reportedMethod,
    reportedRef: inv.reportedRef,
    reportedByName: inv.reportedByName,
    voidReason: inv.voidReason,
    notes: inv.notes,
    provisionalPeriod: isProvisional(inv, orgPaidUntil, now),
  };
}

export function toPlatformInvoiceRow(inv: Invoice & { organization: { name: string; paidUntil: Date | null } }, now = new Date()): PlatformInvoiceRow {
  return { ...toInvoiceRow(inv, inv.organization.paidUntil, now), organizationName: inv.organization.name, recordedByName: inv.recordedByName };
}

export function paymentInstructionsFor(inv: Pick<Invoice, "id" | "number" | "amountBdt" | "organizationId" | "dueAt">): PaymentInstructions {
  return getPaymentProvider().instructions(inv, getPaymentSettings());
}

/** "৳4,000" — server-side twin of formatBdt (src/lib/format.ts is client-only). */
export function bdt(amount: number): string {
  return `৳${amount.toLocaleString("en-US")}`;
}

/** "29 Oct 2026" in the company's timezone. */
export function formatDay(d: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const opts = { day: "numeric", month: "short", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: DEFAULT_TIMEZONE }).format(d);
  }
}

// ── Validation ───────────────────────────────────────────────

const isoDateTime = (label: string) =>
  z
    .string(`${label} must be a date`)
    .trim()
    .max(40)
    .refine((v) => /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v) && !Number.isNaN(new Date(v).getTime()), `${label} must be an ISO date`)
    .transform((v) => new Date(v));

const cycle = z.enum(["MONTHLY", "ANNUAL"], "Choose a billing cycle (MONTHLY or ANNUAL)");
const planCode = z.string("Choose a plan").trim().toLowerCase().min(1, "Choose a plan").max(32, "Choose a plan from the catalog");
const method = z.enum(PAYMENT_METHODS, "Choose how it was paid");
const reference = z.string("Reference must be text").trim().max(100, "Reference must be 100 characters or fewer");

/** Mobile money always has a TrxID. */
function refRequired<T extends { method: PaymentMethod; reference?: string | null }>(d: T, ctx: z.RefinementCtx) {
  if (MOBILE_MONEY_METHODS.includes(d.method) && !d.reference) {
    ctx.addIssue({ code: "custom", path: ["reference"], message: `Enter the ${paymentMethodLabel(d.method)} transaction ID` });
  }
}

/** POST /api/billing/invoices — company admin requests an invoice to subscribe. */
export const requestInvoiceSchema = z.object({ planCode, billingCycle: cycle });

/** POST /api/billing/invoices/[id]/report — "I've paid". */
export const reportPaymentSchema = z.object({ method, reference: reference.optional().nullable() }).superRefine(refRequired);

/** POST /api/platform/invoices — issue an invoice by hand. */
export const createInvoiceSchema = z.object({
  organizationId: z.string("Choose an organization").trim().min(1, "Choose an organization").max(64),
  planCode,
  billingCycle: cycle,
  amountBdt: z.number("Amount must be a whole number of taka").int("Amount must be a whole number of taka").min(1, "Amount must be at least ৳1").max(MAX_INVOICE_BDT, "Amount is too large"),
  periodStart: isoDateTime("Period start").nullish(),
  dueAt: isoDateTime("Due date").nullish(),
  notes: z.string("Notes must be text").trim().max(500, "Notes must be 500 characters or fewer").nullish(),
});

/** PATCH /api/platform/invoices/[id] */
export const invoiceActionSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        action: z.literal("mark-paid"),
        paidAt: isoDateTime("Payment date").nullish(),
        method,
        reference: reference.optional().nullable(),
        note: z.string("Note must be text").trim().max(500, "Note must be 500 characters or fewer").nullish(),
      })
      .superRefine(refRequired),
    z.object({
      action: z.literal("void"),
      reason: z.string("Give a reason").trim().min(3, "Give a reason (at least 3 characters)").max(300, "Reason must be 300 characters or fewer"),
    }),
  ],
  "Unknown action"
);

// ── Numbering ────────────────────────────────────────────────

type Client = Prisma.TransactionClient;

/** Next free-looking number for this year (may still collide under concurrency — see withInvoiceNumber). */
export async function nextInvoiceNumber(client: Client, at: Date): Promise<string> {
  const year = invoiceYear(at);
  const prefix = `${INVOICE_PREFIX}-${year}-`;
  // Zero-padded, so the lexicographic max is the numeric max (up to 99,999 a year).
  const last = await client.invoice.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
  return nextInvoiceNumberAfter(last?.number ?? null, year);
}

/**
 * Run `create(number)` with the next invoice number, retrying with a fresh
 * number when another request took it first (unique constraint on number).
 * `create` must do its own (whole) transaction: Postgres aborts a transaction
 * after a unique violation.
 */
export async function withInvoiceNumber<T>(at: Date, create: (number: string) => Promise<T>, client: Client = db): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const number = await nextInvoiceNumber(client, at);
    try {
      return await create(number);
    } catch (e) {
      if (attempt < MAX_NUMBER_ATTEMPTS && isUniqueViolation(e, "number")) continue;
      throw e;
    }
  }
}

async function lockOrg(tx: Client, organizationId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ${table("Organization")} WHERE id = ${organizationId} FOR UPDATE`;
  if (!locked.length) throw new ApiError(404, "Organization not found");
  return tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
}

// ── Cron: renewals & overdue ─────────────────────────────────

export interface IssueSummary {
  /** Organizations whose period ends soon. */
  due: number;
  issued: number;
  /** Already invoiced for that period. */
  alreadyIssued: number;
  failed: number;
  markedPastDue: number;
}

/**
 * Daily: issue the next period's invoice for every paid organization whose
 * paid period ends within INVOICE_LEAD_DAYS, exactly once per period, then
 * mark overdue ones PAST_DUE. One organization's failure never stops the rest.
 */
export async function issueDueInvoices(now: Date = new Date()): Promise<IssueSummary> {
  const orgs = await db.organization.findMany({
    where: {
      status: "ACTIVE",
      subscriptionStatus: { in: ["ACTIVE", "PAST_DUE"] },
      subscriptionPriceBdt: { gt: 0 },
      paidUntil: { lte: new Date(now.getTime() + INVOICE_LEAD_DAYS * DAY_MS), gte: new Date(now.getTime() - LAPSED_LOOKBACK_DAYS * DAY_MS) },
    },
    select: { id: true, plan: true, billingCycle: true, subscriptionPriceBdt: true, paidUntil: true, planRecord: { select: { name: true } } },
  });

  const summary: IssueSummary = { due: orgs.length, issued: 0, alreadyIssued: 0, failed: 0, markedPastDue: 0 };
  for (const org of orgs) {
    const periodStart = org.paidUntil!;
    try {
      const existing = await db.invoice.findUnique({
        where: { organizationId_periodStart: { organizationId: org.id, periodStart } },
        select: { id: true },
      });
      if (existing) {
        summary.alreadyIssued++;
        continue;
      }
      const billingCycle: BillingCycle = org.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY";
      const invoice = await withInvoiceNumber(now, (number) =>
        db.invoice.create({
          data: {
            organizationId: org.id,
            number,
            planCode: org.plan,
            planName: org.planRecord.name,
            billingCycle,
            periodStart,
            periodEnd: addBillingPeriod(periodStart, billingCycle),
            amountBdt: org.subscriptionPriceBdt!,
            issuedAt: now,
            dueAt: periodStart,
          },
        })
      );
      summary.issued++;
      await bestEffort("invoice issued", () => notifyInvoiceIssued(invoice.id));
    } catch (e) {
      // A concurrent cron run issued it first: still exactly once.
      if (isUniqueViolation(e, "periodStart")) {
        summary.alreadyIssued++;
        continue;
      }
      summary.failed++;
      console.error("[billing] could not issue renewal invoice:", org.id, e);
    }
  }

  try {
    summary.markedPastDue = await markOverdue(now);
  } catch (e) {
    console.error("[billing] could not mark overdue subscriptions:", e);
  }
  return summary;
}

/** ACTIVE → PAST_DUE when an OPEN invoice is past due and the paid period has ended. Returns how many changed. */
export async function markOverdue(now: Date): Promise<number> {
  const overdue = await db.invoice.findMany({
    where: {
      status: "OPEN",
      dueAt: { lt: now },
      // A payment awaiting verification isn't treated as overdue.
      reportedAt: null,
      organization: { status: "ACTIVE", subscriptionStatus: "ACTIVE", paidUntil: { lt: now } },
    },
    select: { organizationId: true, number: true },
    orderBy: { dueAt: "asc" },
  });
  const byOrg = new Map<string, string>();
  for (const i of overdue) if (!byOrg.has(i.organizationId)) byOrg.set(i.organizationId, i.number);

  let changed = 0;
  for (const [organizationId, number] of byOrg) {
    const done = await db.$transaction(async (tx) => {
      const { count } = await tx.organization.updateMany({
        where: { id: organizationId, subscriptionStatus: "ACTIVE", paidUntil: { lt: now } },
        data: { subscriptionStatus: "PAST_DUE" },
      });
      if (!count) return false;
      const detail = { invoice: number, from: "ACTIVE", to: "PAST_DUE" };
      await tx.platformAuditLog.create({
        data: platformAuditData({ actor: null, action: "SUBSCRIPTION_PAST_DUE", targetType: "Organization", targetId: organizationId, organizationId, detail }),
      });
      await tx.auditLog.create({
        data: auditData({ organizationId, actorName: BILLING_ACTOR_NAME, action: "SUBSCRIPTION_PAST_DUE", entityType: "Organization", entityId: organizationId, detail }),
      });
      return true;
    }, TX_OPTIONS);
    if (done) changed++;
  }
  return changed;
}

// ── Company: request, report ─────────────────────────────────

interface CompanyActor {
  id: string;
  name: string;
  organizationId: string;
}

/**
 * Self-service: a company admin picks a public plan and cycle and gets an OPEN
 * invoice with a provisional period (it restarts when the payment is
 * confirmed). Any other OPEN invoice is voided ("Replaced by …") so there is
 * at most one to pay — unless one already has a reported payment (409).
 */
export async function requestInvoice(user: CompanyActor, input: z.infer<typeof requestInvoiceSchema>, now: Date = new Date()): Promise<Invoice> {
  const invoice = await withInvoiceNumber(now, (number) =>
    db.$transaction(async (tx) => {
      const org = await lockOrg(tx, user.organizationId);
      const blocked = requestBlockedReason(org, now);
      if (blocked) throw new ApiError(409, blocked);

      const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
      if (!plan || (plan.code !== org.plan && (!plan.active || !plan.isPublic))) throw new ApiError(400, "Choose one of the listed plans");
      const amountBdt = requestedAmount(plan, input.billingCycle, org);

      const open = await tx.invoice.findMany({ where: { organizationId: org.id, status: "OPEN" }, select: { id: true, number: true, reportedAt: true } });
      const reported = open.find((i) => i.reportedAt);
      if (reported) {
        throw new ApiError(409, `Your payment for ${reported.number} is being verified — FleetFlow will confirm it within 1 business day.`);
      }
      if (open.length) {
        await tx.invoice.updateMany({
          where: { id: { in: open.map((i) => i.id) }, status: "OPEN" },
          data: { status: "VOID", voidReason: `Replaced by ${number}` },
        });
      }
      const created = await tx.invoice.create({
        data: {
          organizationId: org.id,
          number,
          planCode: plan.code,
          planName: plan.name,
          billingCycle: input.billingCycle,
          periodStart: now,
          periodEnd: addBillingPeriod(now, input.billingCycle),
          amountBdt,
          issuedAt: now,
          dueAt: new Date(now.getTime() + INVOICE_DUE_DAYS * DAY_MS),
          notes: "Requested in Plan & billing. The period starts when the payment is confirmed.",
        },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: org.id,
          actorId: user.id,
          actorName: user.name,
          action: "INVOICE_REQUESTED",
          entityType: "Invoice",
          entityId: created.id,
          detail: { number, plan: plan.code, billingCycle: input.billingCycle, amountBdt, replaced: open.map((i) => i.number) },
        }),
      });
      return created;
    }, TX_OPTIONS)
  );
  await bestEffort("invoice issued", () => notifyInvoiceIssued(invoice.id));
  return invoice;
}

/** "I've paid": record the company's payment report on an OPEN invoice of its own organization. */
export async function reportPayment(
  user: CompanyActor,
  invoiceId: string,
  input: z.infer<typeof reportPaymentSchema>,
  now: Date = new Date()
): Promise<Invoice> {
  const updated = await db.$transaction(async (tx) => {
    // Scoped to the caller's organization: another tenant's id is simply "not found".
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: user.organizationId } });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status !== "OPEN") throw new ApiError(409, inv.status === "PAID" ? "This invoice is already paid" : "This invoice was voided");
    const ref = input.reference ? input.reference : null;
    const { count } = await tx.invoice.updateMany({
      where: { id: inv.id, organizationId: user.organizationId, status: "OPEN" },
      data: { reportedAt: now, reportedMethod: input.method, reportedRef: ref, reportedById: user.id, reportedByName: user.name },
    });
    if (!count) throw new ApiError(409, "This invoice changed — reload and try again");
    await tx.auditLog.create({
      data: auditData({
        organizationId: user.organizationId,
        actorId: user.id,
        actorName: user.name,
        action: "INVOICE_PAYMENT_REPORTED",
        entityType: "Invoice",
        entityId: inv.id,
        detail: { number: inv.number, method: input.method, reference: ref },
      }),
    });
    return tx.invoice.findUniqueOrThrow({ where: { id: inv.id } });
  }, TX_OPTIONS);
  await bestEffort("payment reported", () => notifyPaymentReported(updated.id));
  return updated;
}

// ── Platform admin: create, mark paid, void ──────────────────

type Admin = Pick<PlatformAdmin, "id" | "name">;

function invoiceAudit(input: { actor: Admin | null; action: string; invoice: Pick<Invoice, "id" | "organizationId">; detail: Record<string, unknown>; ip?: string | null }) {
  return {
    ...platformAuditData({
      actor: input.actor,
      action: input.action,
      targetType: "Organization",
      targetId: input.invoice.id,
      organizationId: input.invoice.organizationId,
      detail: input.detail,
      ip: input.ip,
    }),
    targetType: "Invoice",
  };
}

function supportAudit(organizationId: string, action: string, invoiceId: string, detail: Record<string, unknown>, actorName = "FleetFlow support") {
  return auditData({ organizationId, actorName, action, entityType: "Invoice", entityId: invoiceId, detail });
}

/**
 * Issue an invoice by hand for any organization, plan, cycle and amount.
 * Period defaults to continuing the current paid period (from paidUntil, if
 * it ended less than LAPSED_LOOKBACK_DAYS ago) or else a provisional period
 * from today; due date defaults to the period start, or INVOICE_DUE_DAYS from
 * now when that has passed.
 */
export async function createInvoice(admin: Admin, input: z.infer<typeof createInvoiceSchema>, ip: string | null, now: Date = new Date()): Promise<Invoice> {
  const invoice = await withInvoiceNumber(now, (number) =>
    db.$transaction(async (tx) => {
      const org = await lockOrg(tx, input.organizationId);
      const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
      if (!plan) throw new ApiError(400, "Choose an existing plan");
      if (plan.code !== org.plan && !plan.active) throw new ApiError(409, `The ${plan.name} plan is inactive and can't be newly invoiced`);

      const continuesFrom =
        org.subscriptionStatus !== "TRIAL" && org.paidUntil && org.paidUntil.getTime() >= now.getTime() - LAPSED_LOOKBACK_DAYS * DAY_MS ? org.paidUntil : null;
      const periodStart = input.periodStart ?? continuesFrom ?? now;
      const dueAt = input.dueAt ?? (periodStart.getTime() > now.getTime() ? periodStart : new Date(now.getTime() + INVOICE_DUE_DAYS * DAY_MS));
      try {
        const created = await tx.invoice.create({
          data: {
            organizationId: org.id,
            number,
            planCode: plan.code,
            planName: plan.name,
            billingCycle: input.billingCycle,
            periodStart,
            periodEnd: addBillingPeriod(periodStart, input.billingCycle),
            amountBdt: input.amountBdt,
            issuedAt: now,
            dueAt,
            notes: input.notes ? input.notes : null,
          },
        });
        const detail = { number, plan: plan.code, billingCycle: input.billingCycle, amountBdt: input.amountBdt, periodStart: periodStart.toISOString(), dueAt: dueAt.toISOString() };
        await tx.platformAuditLog.create({ data: invoiceAudit({ actor: admin, action: "INVOICE_CREATED", invoice: created, detail, ip }) });
        await tx.auditLog.create({ data: supportAudit(org.id, "INVOICE_ISSUED", created.id, detail) });
        return created;
      } catch (e) {
        if (isUniqueViolation(e, "periodStart")) throw new ApiError(409, "This organization already has an invoice starting on that date — void it first or pick another period start");
        throw e;
      }
    }, TX_OPTIONS)
  );
  await bestEffort("invoice issued", () => notifyInvoiceIssued(invoice.id));
  return invoice;
}

export interface MarkPaidInput {
  paidAt?: Date | null;
  method: string;
  reference?: string | null;
  note?: string | null;
}

/**
 * Record a payment: invoice → PAID; organization → ACTIVE, paidUntil extended
 * (and plan/cycle/price switched for a plan-change invoice) — one transaction
 * with audit rows. `admin` null = an online gateway (future). Only OPEN invoices.
 */
export async function markInvoicePaid(
  admin: Admin | null,
  invoiceId: string,
  input: MarkPaidInput,
  ip: string | null,
  now: Date = new Date()
): Promise<Invoice> {
  const paidAt = input.paidAt ?? now;
  if (paidAt.getTime() > now.getTime() + DAY_MS) throw new ApiError(400, "The payment date can't be in the future");
  if (paidAt.getTime() < now.getTime() - 366 * DAY_MS) throw new ApiError(400, "The payment date is more than a year ago");

  const existing = await db.invoice.findUnique({ where: { id: invoiceId }, select: { organizationId: true } });
  if (!existing) throw new ApiError(404, "Invoice not found");

  const paid = await db.$transaction(async (tx) => {
    const org = await lockOrg(tx, existing.organizationId);
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: org.id } });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status !== "OPEN") throw new ApiError(409, inv.status === "PAID" ? "This invoice is already paid" : "A void invoice can't be paid");

    const fx = paymentEffects(inv, org, paidAt);
    const reference = input.reference ? input.reference : null;
    let updated: Invoice;
    try {
      updated = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: "PAID",
          paidAt,
          paymentMethod: input.method,
          paymentRef: reference,
          recordedById: admin?.id ?? null,
          recordedByName: admin?.name ?? null,
          periodStart: fx.period.start,
          periodEnd: fx.period.end,
          ...(input.note ? { notes: inv.notes ? `${inv.notes}\n${input.note}` : input.note } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e, "periodStart")) throw new ApiError(409, "Another invoice of this organization starts on the payment date — pick another payment time");
      throw e;
    }
    await tx.organization.update({ where: { id: org.id }, data: fx.orgData });

    const detail = {
      number: inv.number,
      amountBdt: inv.amountBdt,
      method: input.method,
      reference,
      paidAt: paidAt.toISOString(),
      period: { start: fx.period.start.toISOString(), end: fx.period.end.toISOString(), restarted: fx.period.restarted },
      paidUntil: { from: org.paidUntil?.toISOString() ?? null, to: fx.paidUntil.toISOString() },
      subscriptionStatus: { from: org.subscriptionStatus, to: "ACTIVE" },
      ...(fx.planChange
        ? { plan: { from: { plan: org.plan, billingCycle: org.billingCycle, priceBdt: org.subscriptionPriceBdt }, to: { plan: inv.planCode, billingCycle: inv.billingCycle, priceBdt: inv.amountBdt } } }
        : {}),
    };
    await tx.platformAuditLog.create({ data: invoiceAudit({ actor: admin, action: "INVOICE_PAID", invoice: inv, detail, ip }) });
    await tx.auditLog.create({ data: supportAudit(org.id, "INVOICE_PAID", inv.id, detail, admin ? "FleetFlow support" : BILLING_ACTOR_NAME) });
    return updated;
  }, TX_OPTIONS);

  await bestEffort("invoice paid", () => notifyInvoicePaid(paid.id));
  return paid;
}

export async function voidInvoice(admin: Admin, invoiceId: string, reason: string, ip: string | null): Promise<Invoice> {
  const existing = await db.invoice.findUnique({ where: { id: invoiceId }, select: { organizationId: true } });
  if (!existing) throw new ApiError(404, "Invoice not found");
  return db.$transaction(async (tx) => {
    const org = await lockOrg(tx, existing.organizationId);
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: org.id } });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status !== "OPEN") throw new ApiError(409, inv.status === "PAID" ? "A paid invoice can't be voided" : "This invoice is already void");
    const updated = await tx.invoice.update({ where: { id: inv.id }, data: { status: "VOID", voidReason: reason } });
    const detail = { number: inv.number, amountBdt: inv.amountBdt, reason, hadReportedPayment: !!inv.reportedAt };
    await tx.platformAuditLog.create({ data: invoiceAudit({ actor: admin, action: "INVOICE_VOIDED", invoice: inv, detail, ip }) });
    await tx.auditLog.create({ data: supportAudit(org.id, "INVOICE_VOIDED", inv.id, detail) });
    return updated;
  }, TX_OPTIONS);
}

// ── Notifications (call after commit, inside bestEffort) ─────

/** Billing goes to company ADMINS only — dispatchers have no billing access. */
async function companyAdmins(organizationId: string) {
  return db.user.findMany({ where: { organizationId, role: "ADMIN", active: true }, select: { id: true, email: true } });
}

async function loadForNotice(invoiceId: string) {
  return db.invoice.findUnique({
    where: { id: invoiceId },
    include: { organization: { select: { id: true, name: true, timezone: true, paidUntil: true } } },
  });
}

async function notifyCompanyAdmins(
  organizationId: string,
  notice: { title: string; body: string },
  email: { subject: string; text: string },
  dedupe: string
) {
  const admins = await companyAdmins(organizationId);
  await Promise.all(
    admins.map((a) =>
      Promise.all([
        notifyInApp({ userId: a.id, type: "BILLING", title: notice.title, body: notice.body }),
        notifyEmail({
          organizationId,
          userId: a.id,
          recipientEmail: a.email,
          type: "BILLING",
          title: `[FleetFlow] ${email.subject}`,
          body: email.text,
          dedupeKey: `${dedupe}:${a.id}`,
        }),
      ])
    )
  );
}

export async function notifyInvoiceIssued(invoiceId: string): Promise<void> {
  const inv = await loadForNotice(invoiceId);
  if (!inv || inv.status !== "OPEN") return;
  const tz = inv.organization.timezone;
  const provisional = isProvisional(inv, inv.organization.paidUntil, new Date());
  const period = provisional
    ? `${inv.billingCycle === "ANNUAL" ? "1 year" : "1 month"} from the day your payment is confirmed`
    : `${formatDay(inv.periodStart, tz)} – ${formatDay(inv.periodEnd, tz)}`;
  const instructions = paymentInstructionsFor(inv);
  const howToPay = [...instructions.accounts.map((a) => `${a.label}: ${a.value}`), `Reference: ${instructions.reference}`];
  const content = invoiceIssuedEmail({
    companyName: inv.organization.name,
    invoiceNumber: inv.number,
    planName: inv.planName,
    amount: bdt(inv.amountBdt),
    period,
    dueDate: formatDay(inv.dueAt, tz),
    howToPay,
  });
  await notifyCompanyAdmins(
    inv.organizationId,
    { title: `Invoice ${inv.number}: ${bdt(inv.amountBdt)} due ${formatDay(inv.dueAt, tz)}`, body: `${inv.planName} plan · ${period}. Pay it from Settings → Plan & billing.` },
    content,
    `invoice-issued:${inv.id}`
  );
}

export async function notifyInvoicePaid(invoiceId: string): Promise<void> {
  const inv = await loadForNotice(invoiceId);
  if (!inv || inv.status !== "PAID") return;
  const tz = inv.organization.timezone;
  const paidUntil = inv.organization.paidUntil ? formatDay(inv.organization.paidUntil, tz) : formatDay(inv.periodEnd, tz);
  const content = invoicePaidEmail({ companyName: inv.organization.name, invoiceNumber: inv.number, amount: bdt(inv.amountBdt), planName: inv.planName, paidUntil });
  await notifyCompanyAdmins(
    inv.organizationId,
    { title: `Payment received for ${inv.number}`, body: `Thank you — your ${inv.planName} plan is paid until ${paidUntil}.` },
    content,
    `invoice-paid:${inv.id}`
  );
}

/**
 * Tell FleetFlow staff (BILLING_NOTIFY_EMAIL) about a reported payment. Without
 * that setting it's only logged — the console's "Payments to verify" list is
 * the source of truth either way.
 */
export async function notifyPaymentReported(invoiceId: string): Promise<void> {
  const inv = await loadForNotice(invoiceId);
  if (!inv || inv.status !== "OPEN" || !inv.reportedAt) return;
  const to = process.env.BILLING_NOTIFY_EMAIL?.trim();
  if (!to) {
    console.info(`[billing] payment reported for ${inv.number} (${inv.organization.name}); set BILLING_NOTIFY_EMAIL to be emailed.`);
    return;
  }
  const content = invoicePaymentReportedEmail({
    companyName: inv.organization.name,
    invoiceNumber: inv.number,
    amount: bdt(inv.amountBdt),
    method: paymentMethodLabel(inv.reportedMethod),
    reference: inv.reportedRef,
    reportedBy: inv.reportedByName ?? "An admin",
  });
  await notifyEmail({
    organizationId: inv.organizationId,
    userId: null,
    recipientEmail: to,
    type: "BILLING_INTERNAL",
    title: content.subject,
    body: content.text,
    dedupeKey: `invoice-reported:${inv.id}:${inv.reportedAt.getTime()}`,
  });
}
