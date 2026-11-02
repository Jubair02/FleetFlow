import { fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { reportPayment, reportPaymentSchema, toInvoiceRow } from "@/lib/billing";
import { parseBody } from "@/lib/platform-service";

type Params = { params: Promise<{ id: string }> };

// POST /api/billing/invoices/[id]/report { method, reference } → { invoice }
// "I've paid" — recorded for FleetFlow to verify. Own organization's OPEN invoices only.
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const input = parseBody(reportPaymentSchema, await readJson<unknown>(req));
    const invoice = await reportPayment(user, id, input);
    return ok({ invoice: toInvoiceRow(invoice, null) });
  } catch (e) {
    return fail(e);
  }
}
