"use client";

import { useState } from "react";
import { BadgeCheck, Ban, FilePlus2, ReceiptText } from "lucide-react";
import { INVOICE_STATUS_LABELS, paymentMethodLabel, type PlatformInvoiceRow, type PlatformInvoicesData } from "@/lib/billing-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlatformOrgDetail } from "@/lib/platform-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformData } from "../platform-api";
import { BILLING_CYCLE_LABELS, EmptyState, ErrorState, formatBdt } from "../shared";
import { orgInvoicesUrl } from "./invoice-api";
import { CreateInvoiceDialog, MarkPaidDialog, VoidInvoiceDialog } from "./invoice-dialogs";

const STATUS_TONE: Record<string, string> = {
  OPEN: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  VOID: "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
};

export function InvoiceStatusBadge({ inv }: { inv: Pick<PlatformInvoiceRow, "status" | "reportedAt"> }) {
  if (inv.status === "OPEN" && inv.reportedAt) {
    return (
      <Badge variant="outline" className="whitespace-nowrap border-sky-200 bg-sky-50 font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
        Payment reported
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", STATUS_TONE[inv.status] ?? STATUS_TONE.VOID)}>
      {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
    </Badge>
  );
}

function period(inv: PlatformInvoiceRow) {
  return inv.provisionalPeriod
    ? `${inv.billingCycle === "ANNUAL" ? "12 months" : "1 month"} from payment`
    : `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}`;
}

type Nested = { kind: "create" | "paid" | "void" | null; invoice: PlatformInvoiceRow | null; seq: number };

/** Invoices of one organization (organization dialog → Subscription tab). */
export function OrgInvoicesSection({ detail }: { detail: PlatformOrgDetail }) {
  const { data, error, reload } = usePlatformData<PlatformInvoicesData>(orgInvoicesUrl(detail.organization.id));
  const [nested, setNested] = useState<Nested>({ kind: null, invoice: null, seq: 0 });
  const open = (kind: Nested["kind"], invoice: PlatformInvoiceRow | null = null) => setNested((n) => ({ kind, invoice, seq: n.seq + 1 }));
  const close = (o: boolean) => !o && setNested((n) => ({ ...n, kind: null }));

  return (
    <section aria-labelledby="org-invoices-title" className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 id="org-invoices-title" className="text-sm font-semibold">
          Invoices
        </h3>
        <Button size="sm" variant="outline" className="h-11 sm:h-8" onClick={() => open("create")}>
          <FilePlus2 aria-hidden /> Create invoice
        </Button>
      </div>

      {error && !data ? (
        <ErrorState title="Couldn't load invoices" message={error} onRetry={reload} />
      ) : !data ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : data.invoices.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={ReceiptText} title="No invoices yet" description="Renewal invoices are issued automatically 7 days before paid-until for paid plans." />
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {data.invoices.map((inv) => (
            <li key={inv.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums">{inv.number}</span>
                  <InvoiceStatusBadge inv={inv} />
                  <span className="text-sm font-semibold tabular-nums">{formatBdt(inv.amountBdt)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {inv.planName} · {BILLING_CYCLE_LABELS[inv.billingCycle]} · {period(inv)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {inv.status === "PAID"
                    ? `Paid ${formatDate(inv.paidAt)} · ${paymentMethodLabel(inv.paymentMethod)}${inv.paymentRef ? ` · ${inv.paymentRef}` : ""}${inv.recordedByName ? ` · recorded by ${inv.recordedByName}` : ""}`
                    : inv.status === "VOID"
                      ? `Void${inv.voidReason ? ` — ${inv.voidReason}` : ""}`
                      : `Issued ${formatDate(inv.issuedAt)} · due ${formatDate(inv.dueAt)}`}
                </p>
                {inv.status === "OPEN" && inv.reportedAt && (
                  <p className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300">
                    Reported {formatDate(inv.reportedAt)}
                    {inv.reportedByName ? ` by ${inv.reportedByName}` : ""}: {paymentMethodLabel(inv.reportedMethod)}
                    {inv.reportedRef ? ` · ${inv.reportedRef}` : ""}
                  </p>
                )}
              </div>
              {inv.status === "OPEN" && (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" className="h-11 sm:h-8" onClick={() => open("paid", inv)}>
                    <BadgeCheck aria-hidden /> Mark paid
                  </Button>
                  <Button size="sm" variant="ghost" className="h-11 text-rose-600 hover:text-rose-700 sm:h-8 dark:text-rose-400" onClick={() => open("void", inv)}>
                    <Ban aria-hidden /> Void
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <CreateInvoiceDialog key={`c-${nested.seq}`} detail={detail} open={nested.kind === "create"} onOpenChange={close} />
      <MarkPaidDialog key={`p-${nested.seq}`} invoice={nested.invoice} open={nested.kind === "paid"} onOpenChange={close} />
      <VoidInvoiceDialog key={`v-${nested.seq}`} invoice={nested.invoice} open={nested.kind === "void"} onOpenChange={close} />
    </section>
  );
}
