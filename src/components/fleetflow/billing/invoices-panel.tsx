"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, FileText, LoaderCircle, Printer, ReceiptText, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, useApiData } from "@/lib/api-client";
import {
  INVOICE_STATUS_LABELS, MOBILE_MONEY_METHODS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, paymentMethodLabel,
  type CompanyInvoicesData, type InvoiceRow, type PaymentInstructions, type PaymentMethod, type UpgradeOption,
} from "@/lib/billing-types";
import { formatBdt, formatDate } from "@/lib/format";
import type { BillingCycle } from "@/lib/plan-catalog";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

// ─────────────────────────────────────────────────────────────
// Plan & billing → invoices (company admins). Request an invoice to
// subscribe, see how to pay the open one, report "I've paid", print,
// and the invoice history. Rules live server-side in src/lib/billing.ts.
// ─────────────────────────────────────────────────────────────

const PANEL = "rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)]";

const STATUS_TONE: Record<string, string> = {
  OPEN: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  VOID: "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
};

const printUrl = (id: string) => `/api/billing/invoices/${encodeURIComponent(id)}/print`;

function refresh() {
  useAppStore.getState().bump();
}

function StatusBadge({ inv }: { inv: Pick<InvoiceRow, "status" | "reportedAt"> }) {
  if (inv.status === "OPEN" && inv.reportedAt) {
    return (
      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
        Verifying payment
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={STATUS_TONE[inv.status] ?? STATUS_TONE.VOID}>
      {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
    </Badge>
  );
}

function periodLabel(inv: InvoiceRow): string {
  if (inv.provisionalPeriod) return `${inv.billingCycle === "ANNUAL" ? "12 months" : "1 month"} from payment`;
  return `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}`;
}

export function InvoicesPanel() {
  const { data, error, reload } = useApiData<CompanyInvoicesData>("/api/billing/invoices");

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Couldn&apos;t load your invoices</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          {error}
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!data) return <Skeleton className="h-48 w-full rounded-2xl" aria-busy="true" />;

  const open = data.openInvoice;
  const showRequest = data.canRequestInvoice && data.upgradeOptions.length > 0 && !open?.reportedAt;

  return (
    <section aria-labelledby="billing-invoices-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h3 id="billing-invoices-title" className="text-base font-semibold">
          Invoices &amp; payment
        </h3>
        <p className="text-xs text-muted-foreground">Pay by bKash, Nagad or bank transfer — FleetFlow confirms within 1 business day</p>
      </div>

      {open && <OpenInvoiceCard invoice={open} />}
      {showRequest && <RequestInvoiceCard options={data.upgradeOptions} currentPlanCode={data.currentPlanCode} replacing={open?.number ?? null} />}
      {!open && !showRequest && data.requestBlockedReason && data.invoices.length === 0 && (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{data.requestBlockedReason}</p>
      )}

      <InvoiceHistory invoices={data.invoices} />
    </section>
  );
}

// ── Open invoice: how to pay + "I've paid" ───────────────────

function OpenInvoiceCard({ invoice }: { invoice: InvoiceRow & { instructions: PaymentInstructions } }) {
  const [reporting, setReporting] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const overdue = new Date(invoice.dueAt).getTime() < nowMs;
  const ins = invoice.instructions;

  return (
    <div className={cn(PANEL, "overflow-hidden")}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
            <ReceiptText className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">Invoice {invoice.number}</p>
              <StatusBadge inv={invoice} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {invoice.planName} plan · {invoice.billingCycle === "ANNUAL" ? "annual" : "monthly"} · {periodLabel(invoice)}
            </p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-2xl font-semibold tracking-tight tabular-nums">{formatBdt(invoice.amountBdt)}</p>
          <p className={cn("text-xs", overdue && !invoice.reportedAt ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            {overdue ? "Was due" : "Due"} {formatDate(invoice.dueAt)}
          </p>
        </div>
      </div>

      <div className="border-t bg-muted/20 px-5 py-4 sm:px-6">
        {invoice.reportedAt ? (
          <div className="flex items-start gap-3" role="status">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">Payment reported — FleetFlow will confirm within 1 business day</p>
              <p className="mt-0.5 text-muted-foreground">
                {paymentMethodLabel(invoice.reportedMethod)}
                {invoice.reportedRef ? ` · ${invoice.reportedRef}` : ""} · reported {formatDate(invoice.reportedAt)}
                {invoice.reportedByName ? ` by ${invoice.reportedByName}` : ""}
              </p>
              <Button variant="link" className="mt-1 h-auto p-0 text-sm" onClick={() => setReporting(true)}>
                Correct the payment details
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground marker:text-foreground/60">
              {ins.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {ins.accounts.length > 0 && (
              <dl className="grid gap-2 sm:grid-cols-2">
                {ins.accounts.map((a) => (
                  <AccountRow key={a.label} label={a.label} value={a.value} />
                ))}
                <AccountRow label="Reference" value={ins.reference} />
              </dl>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!invoice.reportedAt && (
            <Button className="min-h-11 sm:min-h-9" onClick={() => setReporting(true)}>
              <Send aria-hidden="true" /> I&apos;ve paid
            </Button>
          )}
          <Button variant="outline" className="min-h-11 sm:min-h-9" asChild>
            <a href={printUrl(invoice.id)} target="_blank" rel="noopener">
              <Printer aria-hidden="true" /> View / print invoice
            </a>
          </Button>
        </div>
      </div>
      <ReportPaymentDialog key={String(reporting)} invoice={invoice} open={reporting} onOpenChange={setReporting} />
    </div>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy — select the text and copy it manually");
    }
  };
  return (
    <div className="flex min-w-0 items-start justify-between gap-2 rounded-xl border bg-card px-3 py-2">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium break-words whitespace-pre-line tabular-nums">{value}</dd>
      </div>
      <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={copy} aria-label={`Copy ${label}`}>
        <Copy className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function ReportPaymentDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: InvoiceRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>((invoice.reportedMethod as PaymentMethod) ?? "BKASH");
  const [reference, setReference] = useState(invoice.reportedRef ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const refRequired = MOBILE_MONEY_METHODS.includes(method);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ref = reference.trim();
    if (refRequired && !ref) {
      setError(`Enter the ${PAYMENT_METHOD_LABELS[method]} transaction ID`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/billing/invoices/${encodeURIComponent(invoice.id)}/report`, { method, reference: ref || null });
      toast.success("Payment reported — FleetFlow will confirm within 1 business day");
      onOpenChange(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't report the payment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>I&apos;ve paid {invoice.number}</DialogTitle>
            <DialogDescription>
              Tell us how you paid {formatBdt(invoice.amountBdt)}. FleetFlow checks the payment and confirms within 1 business day.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Paid with</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)} disabled={submitting}>
              <SelectTrigger id="pay-method" className="h-11 w-full sm:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">
              {refRequired ? "Transaction ID (TrxID)" : "Reference"}{" "}
              {!refRequired && <span className="font-normal text-muted-foreground">(optional)</span>}
            </Label>
            <Input
              id="pay-ref"
              className="h-11 sm:h-9"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={100}
              placeholder={refRequired ? "e.g. 8N7A6B5C4D" : method === "BANK" ? "Bank transfer reference" : ""}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={!!error || undefined}
            />
          </div>
          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-9" disabled={submitting}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Report payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Request an invoice (subscribe) ───────────────────────────

function priceFor(o: UpgradeOption, cycle: BillingCycle): number | null {
  const p = cycle === "ANNUAL" ? o.annualPriceBdt : o.monthlyPriceBdt;
  return p && p > 0 ? p : null;
}

function RequestInvoiceCard({ options, currentPlanCode, replacing }: { options: UpgradeOption[]; currentPlanCode: string; replacing: string | null }) {
  const initial = options.find((o) => o.code === currentPlanCode) ?? options[0];
  const [code, setCode] = useState(initial.code);
  const [cycle, setCycle] = useState<BillingCycle>(priceFor(initial, "MONTHLY") ? "MONTHLY" : "ANNUAL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = options.find((o) => o.code === code) ?? initial;
  const price = priceFor(plan, cycle);

  const choosePlan = (next: string) => {
    setCode(next);
    const p = options.find((o) => o.code === next);
    if (p && !priceFor(p, cycle)) setCycle(cycle === "MONTHLY" ? "ANNUAL" : "MONTHLY");
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<{ invoice: InvoiceRow }>("/api/billing/invoices", { planCode: code, billingCycle: cycle });
      toast.success(`Invoice ${res.invoice.number} created — pay it to start your ${plan.name} plan`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the invoice");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn(PANEL, "flex flex-col gap-4 p-5 sm:p-6")}>
      <div>
        <p className="font-semibold">{replacing ? "Choose a different plan" : "Subscribe"}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pick a plan and billing cycle and we&apos;ll create an invoice. Your paid period starts the day FleetFlow confirms your payment.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="req-plan">Plan</Label>
          <Select value={code} onValueChange={choosePlan} disabled={submitting}>
            <SelectTrigger id="req-plan" className="h-11 w-full sm:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.code} value={o.code}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium" id="req-cycle-label">
            Billing
          </span>
          <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-labelledby="req-cycle-label">
            {(["MONTHLY", "ANNUAL"] as const).map((c) => {
              const available = !!priceFor(plan, c);
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cycle === c}
                  disabled={!available || submitting}
                  onClick={() => setCycle(c)}
                  className={cn(
                    "min-h-10 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-40 sm:min-h-8",
                    cycle === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {c === "MONTHLY" ? "Monthly" : "Annual"}
                </button>
              );
            })}
          </div>
        </div>
        <Button className="min-h-11 sm:min-h-9" onClick={submit} disabled={submitting || !price}>
          {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
          Request invoice{price ? ` · ${formatBdt(price)}` : ""}
        </Button>
      </div>
      {replacing && <p className="text-xs text-muted-foreground">This replaces your open invoice {replacing}.</p>}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── History ──────────────────────────────────────────────────

function InvoiceHistory({ invoices }: { invoices: InvoiceRow[] }) {
  if (invoices.length === 0) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No invoices yet.</p>;
  }
  return (
    <div className={cn(PANEL, "overflow-hidden")}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Invoice history</caption>
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Invoice</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Period</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Due / paid</th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">Print</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="px-4 py-3 font-medium whitespace-nowrap tabular-nums">
                  {inv.number}
                  <span className="block text-xs font-normal text-muted-foreground">{inv.planName}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{periodLabel(inv)}</td>
                <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">{formatBdt(inv.amountBdt)}</td>
                <td className="px-4 py-3"><StatusBadge inv={inv} /></td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {inv.status === "PAID" ? `Paid ${formatDate(inv.paidAt)}` : inv.status === "VOID" ? (inv.voidReason ?? "—") : `Due ${formatDate(inv.dueAt)}`}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="icon" className="size-9" asChild>
                    <a href={printUrl(inv.id)} target="_blank" rel="noopener" aria-label={`View or print invoice ${inv.number}`}>
                      <Printer className="size-4" aria-hidden="true" />
                    </a>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
