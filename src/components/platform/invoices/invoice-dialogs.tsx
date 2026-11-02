"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  MOBILE_MONEY_METHODS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, paymentMethodLabel,
  type InvoiceRow, type PaymentMethod,
} from "@/lib/billing-types";
import { formatDate } from "@/lib/format";
import { listPrice, type BillingCycle } from "@/lib/plan-catalog";
import type { PlatformOrgDetail, PlatformPlansData } from "@/lib/platform-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePlatformData } from "../platform-api";
import { BILLING_CYCLE_LABELS, Callout, ConfirmDialog, errorProps, FieldError, formatBdt } from "../shared";
import { createInvoice, dayToIso, patchInvoice, todayInput } from "./invoice-api";

// ─────────────────────────────────────────────────────────────
// Platform invoice dialogs: mark paid, void, create. Mount each with a
// fresh `key` per open (ConfirmDialog keeps its own submit/error state).
// ─────────────────────────────────────────────────────────────

type InvoiceRef = Pick<InvoiceRow, "id" | "number" | "amountBdt" | "planName" | "reportedMethod" | "reportedRef" | "reportedAt" | "reportedByName"> & {
  organizationName?: string;
};

export function MarkPaidDialog({ invoice, open, onOpenChange }: { invoice: InvoiceRef | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [day, setDay] = useState(todayInput());
  const [method, setMethod] = useState<PaymentMethod>((invoice?.reportedMethod as PaymentMethod | null) || "BKASH");
  const [reference, setReference] = useState(invoice?.reportedRef ?? "");
  const [note, setNote] = useState("");
  const [refError, setRefError] = useState<string | undefined>();
  if (!invoice) return null;
  const refRequired = MOBILE_MONEY_METHODS.includes(method);

  const confirm = async () => {
    const ref = reference.trim();
    if (refRequired && !ref) {
      setRefError(`Enter the ${PAYMENT_METHOD_LABELS[method]} transaction ID`);
      throw new Error("A transaction ID is required for mobile-money payments");
    }
    setRefError(undefined);
    await patchInvoice(invoice.id, {
      action: "mark-paid",
      // Today = "now" on the server (precise period start); another day = that day.
      paidAt: day && day !== todayInput() ? dayToIso(day) : null,
      method,
      reference: ref || null,
      note: note.trim() || null,
    });
    toast.success(`${invoice.number} marked paid`);
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark ${invoice.number} paid`}
      description={
        <>
          {invoice.organizationName ? `${invoice.organizationName} · ` : ""}
          {formatBdt(invoice.amountBdt)} · {invoice.planName}
        </>
      }
      confirmLabel="Mark paid"
      onConfirm={confirm}
    >
      <div className="flex flex-col gap-4">
        {invoice.reportedAt && (
          <Callout tone="zinc">
            Reported {formatDate(invoice.reportedAt)}
            {invoice.reportedByName ? ` by ${invoice.reportedByName}` : ""}: {paymentMethodLabel(invoice.reportedMethod)}
            {invoice.reportedRef ? ` · ${invoice.reportedRef}` : ""}. Check it against the statement before confirming.
          </Callout>
        )}
        <Callout>
          Sets the subscription Active and extends paid-until to the end of the invoiced period. An invoice for a different plan or cycle (or
          a trial) also switches the plan, and its period starts on the payment date.
        </Callout>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="paid-day">Payment date</Label>
            <Input id="paid-day" type="date" className="h-11 sm:h-9" value={day} max={todayInput()} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paid-method">Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="paid-method" className="h-11 w-full sm:h-9">
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
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="paid-ref">
            {refRequired ? "Transaction ID" : "Reference"} {!refRequired && <span className="font-normal text-muted-foreground">(optional)</span>}
          </Label>
          <Input
            id="paid-ref"
            className="h-11 sm:h-9"
            value={reference}
            maxLength={100}
            onChange={(e) => setReference(e.target.value)}
            autoComplete="off"
            {...errorProps("paid-ref", refError)}
          />
          <FieldError id="paid-ref-error" message={refError} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="paid-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea id="paid-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </ConfirmDialog>
  );
}

export function VoidInvoiceDialog({ invoice, open, onOpenChange }: { invoice: InvoiceRef | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
  if (!invoice) return null;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Void ${invoice.number}?`}
      description="The invoice stays in the history as void and can't be paid any more. Nothing else changes."
      confirmLabel="Void invoice"
      destructive
      canConfirm={reason.trim().length >= 3}
      onConfirm={async () => {
        await patchInvoice(invoice.id, { action: "void", reason: reason.trim() });
        toast.success(`${invoice.number} voided`);
      }}
    >
      <div className="space-y-1.5">
        {invoice.reportedAt && (
          <Callout tone="rose" className="mb-3">
            The company reported paying this invoice. Make sure the payment really didn&apos;t arrive (or was refunded) before voiding.
          </Callout>
        )}
        <Label htmlFor="void-reason">Reason</Label>
        <Textarea id="void-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Issued with the wrong amount" />
        <p className="text-xs text-muted-foreground">Shown to the company in its invoice history.</p>
      </div>
    </ConfirmDialog>
  );
}

const CYCLES: BillingCycle[] = ["MONTHLY", "ANNUAL"];

export function CreateInvoiceDialog({ detail, open, onOpenChange }: { detail: PlatformOrgDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = detail.organization;
  const { data: plansData } = usePlatformData<PlatformPlansData>(open ? "/api/platform/plans" : null);
  const options = (plansData?.plans ?? []).filter((p) => p.active || p.code === org.plan);
  if (!options.some((p) => p.code === org.plan)) options.unshift({ ...detail.planDetail, organizationCount: 0, grandfatheredCount: 0 });

  const suggested = (code: string, cycle: BillingCycle) => {
    if (code === org.plan && cycle === org.billingCycle && org.subscriptionPriceBdt) return org.subscriptionPriceBdt;
    const p = options.find((o) => o.code === code);
    return p ? listPrice(p, cycle) : null;
  };

  const [plan, setPlan] = useState(org.plan);
  const [cycle, setCycle] = useState<BillingCycle>(org.billingCycle);
  const [amount, setAmount] = useState(() => {
    const s = suggested(org.plan, org.billingCycle);
    return s ? String(s) : "";
  });
  const [periodStart, setPeriodStart] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [notes, setNotes] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();

  const pick = (nextPlan: string, nextCycle: BillingCycle) => {
    setPlan(nextPlan);
    setCycle(nextCycle);
    const s = suggested(nextPlan, nextCycle);
    if (s) setAmount(String(s));
  };

  const confirm = async () => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > 10_000_000) {
      setAmountError("Enter a whole number of taka (at least ৳1)");
      throw new Error("Check the amount");
    }
    setAmountError(undefined);
    const res = await createInvoice({
      organizationId: org.id,
      planCode: plan,
      billingCycle: cycle,
      amountBdt: n,
      periodStart: dayToIso(periodStart),
      dueAt: dayToIso(dueDay),
      notes: notes.trim() || null,
    });
    toast.success(`Invoice ${res.invoice.number} issued — the company's admins were notified`);
  };

  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} title="Create invoice" description={org.name} confirmLabel="Issue invoice" onConfirm={confirm}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="inv-plan">Plan</Label>
            <Select value={plan} onValueChange={(v) => pick(v, cycle)}>
              <SelectTrigger id="inv-plan" className="h-11 w-full sm:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.name}
                    {!p.active ? " (inactive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-cycle">Billing cycle</Label>
            <Select value={cycle} onValueChange={(v) => pick(plan, v as BillingCycle)}>
              <SelectTrigger id="inv-cycle" className="h-11 w-full sm:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CYCLES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {BILLING_CYCLE_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-amount">Amount (৳, whole taka)</Label>
          <Input
            id="inv-amount"
            inputMode="numeric"
            className="h-11 sm:h-9"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            {...errorProps("inv-amount", amountError)}
          />
          <FieldError id="inv-amount-error" message={amountError} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="inv-start">
              Period start <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="inv-start" type="date" className="h-11 sm:h-9" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-due">
              Due date <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="inv-due" type="date" className="h-11 sm:h-9" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          Empty period start: continues from paid-until{org.paidUntil ? ` (${formatDate(org.paidUntil)})` : ""}, or starts when paid. Empty due date:
          the period start, or 7 days from today.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="inv-notes">
            Notes <span className="font-normal text-muted-foreground">(optional, shown to the company)</span>
          </Label>
          <Textarea id="inv-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </ConfirmDialog>
  );
}
