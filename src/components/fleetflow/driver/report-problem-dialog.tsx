"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { FAILURE_REASONS } from "@/lib/constants";
import type { MyJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PRESS } from "./job-utils";
import { SheetBody, SheetDialogContent, SheetFooter, SheetHeader } from "./ui";

/** Mark a job FAILED with a reason. */
export function ReportProblemDialog({
  job,
  onClose,
  onReported,
  onFailed,
}: {
  job: MyJob;
  onClose: () => void;
  onReported: () => void;
  onFailed: () => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tried, setTried] = useState(false);

  const noteRequired = reason === "OTHER";
  const noteMissing = tried && noteRequired && !note.trim();

  const submit = async () => {
    setTried(true);
    if (!reason) {
      toast.error("Select what went wrong");
      return;
    }
    if (noteRequired && !note.trim()) {
      toast.error("Add a note describing the problem");
      return;
    }
    setSubmitting(true);
    try {
      const body: { status: "FAILED"; failureReason: string; note?: string } = {
        status: "FAILED",
        failureReason: reason,
      };
      if (note.trim()) body.note = note.trim();
      await api.post(`/api/deliveries/${job.id}/status`, body);
      toast.success("Problem reported — the dispatcher has been notified");
      onReported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not report the problem");
      onFailed();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <SheetDialogContent className="sm:max-w-md" closeDisabled={submitting}>
        <SheetHeader
          title="Report a problem"
          description={
            <>
              Mark <span className="font-mono text-xs font-medium tracking-wider text-foreground">{job.trackingCode}</span> as failed
              and alert your dispatcher.
            </>
          }
        />

        <SheetBody className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="report-reason" className="text-sm font-medium">
              What went wrong? *
            </Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="report-reason" className="h-12 w-full rounded-xl text-[15px] data-[size=default]:h-12" aria-invalid={tried && !reason}>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {FAILURE_REASONS.map((r) => (
                  <SelectItem key={r.code} value={r.code} className="min-h-11 text-[15px]">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tried && !reason && <p className="text-sm text-rose-700 dark:text-rose-400">Select a reason so dispatch knows what happened.</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="report-note" className="text-sm font-medium">
              Internal note {noteRequired ? "*" : <span className="font-normal text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              id="report-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                noteRequired
                  ? "Describe what happened — required when the reason is “Other”."
                  : "Anything dispatch should know — visible to your team only."
              }
              className="min-h-24 rounded-xl text-base md:text-[15px]"
              aria-invalid={noteMissing}
            />
            {noteMissing && <p className="text-sm text-rose-700 dark:text-rose-400">Describe the problem so dispatch knows what happened.</p>}
          </div>

          <div
            className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-3.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60"
            role="status"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>The dispatcher is notified immediately.</span>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="h-12 rounded-xl sm:h-11">
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={submit}
            disabled={submitting}
            className={cn("h-12 rounded-xl text-[15px] font-semibold sm:h-11", PRESS)}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
            {submitting ? "Reporting…" : "Report problem"}
          </Button>
        </SheetFooter>
      </SheetDialogContent>
    </Dialog>
  );
}
