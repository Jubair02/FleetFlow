import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { paymentInstructionsFor, requestBlockedReason, requestInvoice, requestInvoiceSchema, toInvoiceRow } from "@/lib/billing";
import type { CompanyInvoicesData } from "@/lib/billing-types";
import { parseBody } from "@/lib/platform-service";

const MAX_INVOICES = 100;

// GET /api/billing/invoices → CompanyInvoicesData (admins only; own organization only)
export async function GET() {
  try {
    const user = await requireAdmin();
    const now = new Date();
    const [org, invoices, plans] = await Promise.all([
      db.organization.findUnique({
        where: { id: user.organizationId },
        select: { plan: true, status: true, subscriptionStatus: true, paidUntil: true },
      }),
      db.invoice.findMany({
        where: { organizationId: user.organizationId },
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        take: MAX_INVOICES,
      }),
      db.plan.findMany({
        where: { active: true, isPublic: true, OR: [{ monthlyPriceBdt: { gt: 0 } }, { annualPriceBdt: { gt: 0 } }] },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { code: true, name: true, monthlyPriceBdt: true, annualPriceBdt: true },
      }),
    ]);
    if (!org) throw new ApiError(404, "Organization not found");

    const open = invoices.filter((i) => i.status === "OPEN").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0] ?? null;
    const blocked = requestBlockedReason(org, now);
    const body: CompanyInvoicesData = {
      invoices: invoices.map((i) => toInvoiceRow(i, org.paidUntil, now)),
      openInvoice: open ? { ...toInvoiceRow(open, org.paidUntil, now), instructions: paymentInstructionsFor(open) } : null,
      canRequestInvoice: blocked === null,
      requestBlockedReason: blocked,
      upgradeOptions: plans,
      currentPlanCode: org.plan,
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}

// POST /api/billing/invoices { planCode, billingCycle } → { invoice } (201)
// Self-service: request an invoice to subscribe (trial / lapsed / cancelled only).
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const input = parseBody(requestInvoiceSchema, await readJson<unknown>(req));
    const invoice = await requestInvoice(user, input);
    return ok({ invoice: toInvoiceRow(invoice, null) }, 201);
  } catch (e) {
    return fail(e);
  }
}
