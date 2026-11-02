import { fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { invoiceActionSchema, markInvoicePaid, voidInvoice } from "@/lib/billing";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { parseBody } from "@/lib/platform-service";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/platform/invoices/[id]
//   { action: "mark-paid", paidAt?, method, reference?, note? } — extends paidUntil (src/lib/billing.ts)
//   { action: "void", reason }
// → { success, status }. Every action writes a PlatformAuditLog row and a tenant AuditLog row.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await params;
    const input = parseBody(invoiceActionSchema, await readJson<unknown>(req));
    const ip = clientIp(req);
    const invoice =
      input.action === "mark-paid"
        ? await markInvoicePaid(admin, id, { paidAt: input.paidAt, method: input.method, reference: input.reference, note: input.note }, ip)
        : await voidInvoice(admin, id, input.reason, ip);
    return ok({ success: true, status: invoice.status });
  } catch (e) {
    return fail(e);
  }
}
