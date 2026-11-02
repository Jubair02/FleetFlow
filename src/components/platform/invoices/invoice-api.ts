import { bumpPlatformData, platformApi, withQuery } from "../platform-api";

export const INVOICES_URL = "/api/platform/invoices";

export const orgInvoicesUrl = (organizationId: string) => withQuery(INVOICES_URL, { organizationId });
export const PAYMENTS_TO_VERIFY_URL = withQuery(INVOICES_URL, { reported: 1, take: 50 });

export interface CreateInvoiceBody {
  organizationId: string;
  planCode: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  amountBdt: number;
  periodStart?: string | null;
  dueAt?: string | null;
  notes?: string | null;
}

export type InvoiceAction =
  | { action: "mark-paid"; paidAt?: string | null; method: string; reference?: string | null; note?: string | null }
  | { action: "void"; reason: string };

/** Every rule (status, scope, audit) is enforced server-side; these refresh the console afterwards. */
export async function createInvoice(body: CreateInvoiceBody) {
  const res = await platformApi.post<{ invoice: { id: string; number: string } }>(INVOICES_URL, body);
  bumpPlatformData();
  return res;
}

export async function patchInvoice(id: string, body: InvoiceAction) {
  const res = await platformApi.patch<{ success: boolean; status: string }>(`${INVOICES_URL}/${encodeURIComponent(id)}`, body);
  bumpPlatformData();
  return res;
}

/** "YYYY-MM-DD" from a date input → ISO instant (UTC midnight), or null for empty. */
export function dayToIso(day: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00.000Z`).toISOString() : null;
}

/** Today as "YYYY-MM-DD" in the viewer's timezone (date input default). */
export function todayInput(now = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
