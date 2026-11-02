import type { Invoice } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, requireAdmin } from "@/lib/api-helpers";
import { bdt, formatDay, isProvisional, paymentInstructionsFor } from "@/lib/billing";
import { INVOICE_STATUS_LABELS, paymentMethodLabel } from "@/lib/billing-types";
import { escapeHtml } from "@/lib/email/templates";

type Params = { params: Promise<{ id: string }> };

// GET /api/billing/invoices/[id]/print → printable HTML invoice (opens in a new tab).
// Session-checked like every billing API: admins only, and the invoice must
// belong to the caller's organization (another tenant's id is a 404).
export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const inv = await db.invoice.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { organization: { select: { name: true, address: true, contactEmail: true, phone: true, timezone: true, paidUntil: true } } },
    });
    if (!inv) throw new ApiError(404, "Invoice not found");
    return new Response(renderInvoiceHtml(inv), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}

type PrintableInvoice = Invoice & {
  organization: { name: string; address: string | null; contactEmail: string | null; phone: string | null; timezone: string; paidUntil: Date | null };
};

const e = (s: string | null | undefined) => escapeHtml(s ?? "");

function renderInvoiceHtml(inv: PrintableInvoice): string {
  const org = inv.organization;
  const tz = org.timezone;
  const day = (d: Date) => formatDay(d, tz);
  const provisional = isProvisional(inv, org.paidUntil, new Date());
  const period = provisional
    ? `${inv.billingCycle === "ANNUAL" ? "12 months" : "1 month"} from the payment date`
    : `${day(inv.periodStart)} – ${day(inv.periodEnd)}`;
  const instructions = inv.status === "OPEN" ? paymentInstructionsFor(inv) : null;
  const billTo = [org.name, org.address, org.contactEmail, org.phone].filter(Boolean).map((l) => `<div>${e(l)}</div>`).join("");

  const statusLine =
    inv.status === "PAID"
      ? `Paid ${inv.paidAt ? day(inv.paidAt) : ""} · ${e(paymentMethodLabel(inv.paymentMethod))}${inv.paymentRef ? ` · ref ${e(inv.paymentRef)}` : ""}`
      : inv.status === "VOID"
        ? `Void${inv.voidReason ? ` — ${e(inv.voidReason)}` : ""}`
        : `Due ${day(inv.dueAt)}`;

  const pay = instructions
    ? `<section class="pay"><h2>How to pay</h2>
        ${instructions.accounts.length ? `<table class="accounts">${instructions.accounts.map((a) => `<tr><th>${e(a.label)}</th><td>${e(a.value).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>` : ""}
        <ol>${instructions.steps.map((s) => `<li>${e(s)}</li>`).join("")}</ol>
        <p>Payment reference: <strong>${e(instructions.reference)}</strong></p></section>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${e(inv.number)} — FleetFlow</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f4f5; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #18181b; }
  .page { max-width: 760px; margin: 24px auto; background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgb(0 0 0 / .08); }
  header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 1px solid #e4e4e7; padding-bottom: 24px; }
  .brand { font-size: 20px; font-weight: 700; color: #047857; }
  h1 { margin: 0; font-size: 24px; letter-spacing: -.01em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #71717a; margin: 0 0 8px; }
  .muted { color: #71717a; }
  .status { display: inline-block; margin-top: 6px; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid #d4d4d8; }
  .status.PAID { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }
  .status.OPEN { background: #fffbeb; border-color: #fde68a; color: #b45309; }
  .status.VOID { background: #f4f4f5; color: #52525b; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
  table { width: 100%; border-collapse: collapse; }
  .lines th, .lines td { text-align: left; padding: 10px 0; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  .lines th:last-child, .lines td:last-child { text-align: right; }
  .lines tfoot td { font-weight: 700; font-size: 16px; border-bottom: 0; }
  .pay { margin-top: 28px; padding: 16px 20px; border: 1px solid #e4e4e7; border-radius: 10px; background: #fafafa; }
  .accounts th { text-align: left; width: 140px; padding: 4px 0; font-weight: 600; vertical-align: top; }
  .accounts td { padding: 4px 0; }
  .actions { max-width: 760px; margin: 0 auto; padding: 16px 0 0; text-align: right; }
  button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 0; background: #047857; color: #fff; cursor: pointer; }
  footer { margin-top: 32px; font-size: 12px; color: #a1a1aa; }
  @media (max-width: 640px) { .page { padding: 20px; margin: 0; border-radius: 0; } .grid { grid-template-columns: 1fr; } header { flex-direction: column; } }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .actions { display: none; }
  }
</style></head>
<body>
<div class="actions"><button type="button" onclick="window.print()">Print / save as PDF</button></div>
<main class="page">
  <header>
    <div><div class="brand">FleetFlow</div><div class="muted">Delivery management</div></div>
    <div style="text-align:right">
      <h1>Invoice ${e(inv.number)}</h1>
      <div class="muted">Issued ${day(inv.issuedAt)}</div>
      <span class="status ${e(inv.status)}">${e(INVOICE_STATUS_LABELS[inv.status] ?? inv.status)}</span>
      <div class="muted" style="margin-top:4px">${statusLine}</div>
    </div>
  </header>
  <div class="grid">
    <section><h2>Billed to</h2>${billTo}</section>
    <section><h2>Details</h2>
      <div>Plan: ${e(inv.planName)}</div>
      <div>Billing: ${inv.billingCycle === "ANNUAL" ? "Annual" : "Monthly"}</div>
      <div>Period: ${e(period)}</div>
    </section>
  </div>
  <table class="lines">
    <thead><tr><th>Description</th><th>Amount</th></tr></thead>
    <tbody><tr><td>FleetFlow ${e(inv.planName)} plan — ${inv.billingCycle === "ANNUAL" ? "annual" : "monthly"} subscription<br><span class="muted">${e(period)}</span></td><td>${bdt(inv.amountBdt)}</td></tr></tbody>
    <tfoot><tr><td>Total (BDT)</td><td>${bdt(inv.amountBdt)}</td></tr></tfoot>
  </table>
  ${inv.notes ? `<p class="muted" style="margin-top:16px">${e(inv.notes).replace(/\n/g, "<br>")}</p>` : ""}
  ${pay}
  <footer>Amounts in Bangladeshi taka. Questions about this invoice? Reply to the invoice email or contact FleetFlow support.</footer>
</main>
</body></html>`;
}
