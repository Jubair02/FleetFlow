"use client";

import { useState } from "react";
import { BadgeCheck, ChevronRight, Wallet } from "lucide-react";
import { paymentMethodLabel, type PlatformInvoiceRow, type PlatformInvoicesData } from "@/lib/billing-types";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useConsole } from "../console-context";
import { usePlatformData } from "../platform-api";
import { ErrorState, formatBdt } from "../shared";
import { PAYMENTS_TO_VERIFY_URL } from "./invoice-api";
import { MarkPaidDialog } from "./invoice-dialogs";

/**
 * Overview card: OPEN invoices whose company reported a payment, oldest first.
 * Hidden when there is nothing to verify (and while the first load is pending).
 */
export function PaymentsToVerify() {
  const { openOrg } = useConsole();
  const { data, error, reload } = usePlatformData<PlatformInvoicesData>(PAYMENTS_TO_VERIFY_URL);
  const [paying, setPaying] = useState<{ invoice: PlatformInvoiceRow | null; seq: number }>({ invoice: null, seq: 0 });

  if (error && !data) return <ErrorState title="Couldn't load payments to verify" message={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-20 w-full rounded-xl" />;
  if (data.invoices.length === 0) return null;

  return (
    <Card className="border-sky-200 dark:border-sky-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
          Payments to verify
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 tabular-nums dark:bg-sky-950 dark:text-sky-300">{data.total}</span>
        </CardTitle>
        <CardDescription>Companies reported these payments. Check each against the bKash/bank statement, then mark the invoice paid.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {data.invoices.map((inv) => (
            <li key={inv.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                className="group min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                onClick={() => openOrg(inv.organizationId, "subscription")}
              >
                <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium group-hover:underline">
                  {inv.organizationName}
                  <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                </span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {inv.number} · {formatBdt(inv.amountBdt)} · {paymentMethodLabel(inv.reportedMethod)}
                  {inv.reportedRef ? ` ${inv.reportedRef}` : ""} · reported {formatDate(inv.reportedAt)}
                </span>
              </button>
              <Button size="sm" className="h-11 shrink-0 sm:h-8" onClick={() => setPaying((p) => ({ invoice: inv, seq: p.seq + 1 }))}>
                <BadgeCheck aria-hidden /> Mark paid
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
      <MarkPaidDialog
        key={paying.seq}
        invoice={paying.invoice}
        open={paying.invoice !== null}
        onOpenChange={(o) => !o && setPaying((p) => ({ ...p, invoice: null }))}
      />
    </Card>
  );
}
