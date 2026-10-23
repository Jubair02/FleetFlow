"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import type { PlatformOrgDetail, SubscriptionStatus } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Callout, errorProps, FieldError, ServerError, SUBSCRIPTION_LABELS, SUBSCRIPTION_STATUSES } from "../../shared";
import { patchOrg } from "../org-api";
import { OrgFormDialog, type FormControls } from "./org-form-dialog";

const NOTES_MAX = 1000;

/** Edit the manually recorded subscription (existing "update-subscription" action). */
export function SubscriptionDialog({
  open,
  onOpenChange,
  orgId,
  detail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string | null;
  detail?: PlatformOrgDetail | null;
}) {
  return (
    <OrgFormDialog open={open} onOpenChange={onOpenChange} orgId={orgId} detail={detail} title="Edit subscription" className="sm:max-w-md">
      {(d, controls) => <SubscriptionForm detail={d} controls={controls} />}
    </OrgFormDialog>
  );
}

function SubscriptionForm({ detail, controls }: { detail: PlatformOrgDetail; controls: FormControls }) {
  const org = detail.organization;
  const [status, setStatus] = useState<SubscriptionStatus>(org.subscriptionStatus);
  const [paidUntil, setPaidUntil] = useState(org.paidUntil ? org.paidUntil.slice(0, 10) : "");
  const [notes, setNotes] = useState(org.billingNotes ?? "");
  const [errors, setErrors] = useState<{ paidUntil?: string; notes?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (paidUntil && !/^\d{4}-\d{2}-\d{2}$/.test(paidUntil)) found.paidUntil = "Enter a valid date";
    if (notes.length > NOTES_MAX) found.notes = `Notes must be ${NOTES_MAX} characters or fewer`;
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    controls.setBusy(true);
    try {
      await patchOrg(org.id, {
        action: "update-subscription",
        subscriptionStatus: status,
        paidUntil: paidUntil ? new Date(`${paidUntil}T00:00:00.000Z`).toISOString() : null,
        billingNotes: notes.trim() ? notes.trim() : null,
      });
      toast.success("Subscription record updated");
      controls.setBusy(false);
      controls.close();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not update the subscription");
      controls.setBusy(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Edit subscription</DialogTitle>
        <DialogDescription>{org.name}</DialogDescription>
      </DialogHeader>
      <Callout>Recorded manually — no payment is processed. Use this to note what was agreed and paid outside FleetFlow.</Callout>
      <div className="space-y-1.5">
        <Label htmlFor="sub-status">Subscription status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as SubscriptionStatus)} disabled={submitting}>
          <SelectTrigger id="sub-status" className="h-11 w-full sm:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SUBSCRIPTION_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sub-paid">
          Paid until <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <div className="flex gap-2">
          <Input
            id="sub-paid"
            type="date"
            className="h-11 sm:h-9"
            value={paidUntil}
            onChange={(e) => setPaidUntil(e.target.value)}
            disabled={submitting}
            {...errorProps("sub-paid", errors.paidUntil)}
          />
          {paidUntil && (
            <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => setPaidUntil("")} disabled={submitting}>
              Clear
            </Button>
          )}
        </div>
        <FieldError id="sub-paid-error" message={errors.paidUntil} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sub-notes">
          Billing notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="sub-notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={NOTES_MAX}
          placeholder="e.g. Paid ৳4,000 by bKash on 3 Oct, ref 8XK2…"
          disabled={submitting}
          {...errorProps("sub-notes", errors.notes)}
        />
        <div className="flex justify-between">
          <FieldError id="sub-notes-error" message={errors.notes} />
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {notes.length}/{NOTES_MAX}
          </span>
        </div>
      </div>
      <ServerError message={serverError} />
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={controls.close} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-9" disabled={submitting}>
          {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
          Save record
        </Button>
      </DialogFooter>
    </form>
  );
}
