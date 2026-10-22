"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Download, ListChecks, Loader2, RotateCw, Upload } from "lucide-react";

import { rowsToFix, type ImportRow } from "@/lib/delivery-import";
import type { ImportCommitResponse, MappedRow } from "@/lib/import-contract";
import { downloadCsv } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { ErrorBox, StepTitle, Stepper, WarnBox, baseName, fmt, plural, type SourceInput } from "./shared";

// ─────────────────────────────────────────────────────────────
// Step 4 — chunked commit progress, and the final summary.
// ─────────────────────────────────────────────────────────────

export interface CommitChunk {
  rows: MappedRow[];
  allowLikelyDuplicates: number[];
}

export interface CommitSession {
  /** Generated once per import; chunk i is sent with idempotencyKey `${sessionKey}:${i}` — retries reuse it. */
  sessionKey: string;
  chunks: CommitChunk[];
  results: (ImportCommitResponse | null)[];
  state: "running" | "failed" | "refused" | "done" | "stopped";
  error: string | null;
  /** Frozen view of the review step when Import was clicked. */
  snapshot: {
    /** Server verdicts of every row, for the summary and "rows to fix". */
    verdicts: Map<number, ImportRow>;
    /** Invalid rows that were not sent. */
    invalidRows: number[];
    /** Duplicates that were not sent (always skipped). */
    duplicatesSkipped: number;
    excluded: number;
  };
}

export function sessionTotals(s: CommitSession) {
  let imported = 0,
    skipped = s.snapshot.duplicatesSkipped,
    failed = s.snapshot.invalidRows.length,
    emailsQueued = 0,
    doneRows = 0,
    totalRows = 0,
    notConfirmed = 0;
  const batchIds: string[] = [];
  s.chunks.forEach((c, i) => {
    totalRows += c.rows.length;
    const r = s.results[i];
    if (!r) {
      notConfirmed += c.rows.length;
      return;
    }
    doneRows += c.rows.length;
    imported += r.imported;
    skipped += r.skipped;
    failed += r.failed;
    emailsQueued += r.emailsQueued;
    if (r.imported > 0 && !batchIds.includes(r.batchId)) batchIds.push(r.batchId);
  });
  return { imported, skipped, failed, emailsQueued, doneRows, totalRows, notConfirmed, excluded: s.snapshot.excluded, batchIds };
}

/** Rows the user should fix and import again, as ImportRows with status "invalid" (for rowsToFix). */
export function rowsNeedingAttention(s: CommitSession): ImportRow[] {
  const { verdicts } = s.snapshot;
  const out: ImportRow[] = [];
  const asFailed = (rowNumber: number, message: string): ImportRow | null => {
    const v = verdicts.get(rowNumber);
    if (!v) return null;
    if (v.status === "invalid" && v.errors.length) return v;
    return { ...v, status: "invalid", errors: [{ field: "row", message }] };
  };
  for (const n of s.snapshot.invalidRows) {
    const r = asFailed(n, "Not imported");
    if (r) out.push(r);
  }
  s.chunks.forEach((c, i) => {
    const res = s.results[i];
    if (res) {
      for (const n of res.failedRows) {
        const r = asFailed(n, "Rejected when importing — check this row and import it again");
        if (r) out.push(r);
      }
    } else {
      for (const row of c.rows) {
        const r = asFailed(row.rowNumber, "Not imported — the import stopped before this row's batch was confirmed");
        if (r) out.push(r);
      }
    }
  });
  return out.sort((a, b) => a.rowNumber - b.rowNumber);
}

export function downloadRowsToFix(source: SourceInput, rows: ImportRow[]) {
  downloadCsv(`${baseName(source.fileName)}-rows-to-fix.csv`, rowsToFix(rows));
}

// ── Progress ─────────────────────────────────────────────────

export function CommitStep({
  session,
  onRetry,
  onStop,
  onBackToReview,
}: {
  session: CommitSession;
  onRetry: () => void;
  onStop: () => void;
  onBackToReview: () => void;
}) {
  const t = sessionTotals(session);
  const running = session.state === "running";
  const pct = t.totalRows ? Math.round((t.doneRows / t.totalRows) * 100) : 0;
  const current = session.results.findIndex((r) => !r);
  const nothingSaved = t.doneRows === 0;

  return (
    <>
      <DialogHeader className="gap-3">
        <Stepper current={3} />
        <StepTitle>{running ? "Importing deliveries" : "Import paused"}</StepTitle>
        <DialogDescription>
          {running
            ? "Keep this window open. Each batch is saved completely or not at all."
            : "Batches that finished are saved. Nothing was imported twice."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3" aria-live="polite">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <p className="font-medium tabular-nums">
            {running ? `Importing ${fmt(t.doneRows)} of ${fmt(t.totalRows)}…` : `${fmt(t.doneRows)} of ${fmt(t.totalRows)} rows done`}
          </p>
          {session.chunks.length > 1 && current >= 0 ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              Batch {fmt(current + 1)} of {fmt(session.chunks.length)}
            </p>
          ) : null}
        </div>
        <Progress value={pct} aria-label="Import progress" aria-valuetext={`${fmt(t.doneRows)} of ${fmt(t.totalRows)} rows`} />
        {running ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> {plural(t.imported, "delivery", "deliveries")} saved so far
          </p>
        ) : null}
      </div>

      {session.state === "failed" ? (
        <ErrorBox>
          <p>{session.error}</p>
          <p className="mt-1 text-xs">
            Retry continues where it stopped — batches that already finished are recognised and not imported again.
          </p>
        </ErrorBox>
      ) : null}
      {session.state === "refused" ? (
        <ErrorBox>
          <p>{session.error}</p>
          <p className="mt-1 text-xs">
            {nothingSaved ? "Nothing was imported." : `${plural(t.imported, "delivery was", "deliveries were")} imported before this.`}
          </p>
        </ErrorBox>
      ) : null}

      <DialogFooter className="gap-2 sm:justify-end">
        {session.state === "failed" ? (
          <>
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onStop}>
              Stop here
            </Button>
            <Button type="button" className="min-h-11 sm:min-h-9" onClick={onRetry}>
              <RotateCw /> Retry
            </Button>
          </>
        ) : session.state === "refused" ? (
          nothingSaved ? (
            <Button type="button" className="min-h-11 sm:min-h-9" onClick={onBackToReview}>
              <ArrowLeft /> Back to review
            </Button>
          ) : (
            <Button type="button" className="min-h-11 sm:min-h-9" onClick={onStop}>
              <ListChecks /> See summary
            </Button>
          )
        ) : (
          <Button type="button" className="min-h-11 sm:min-h-9" disabled>
            <Loader2 className="animate-spin" /> Importing…
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

// ── Summary ──────────────────────────────────────────────────

const SHOWN_FAILED = 8;

export function SummaryStep({
  source,
  session,
  onAnother,
  onClose,
  onViewImported,
}: {
  source: SourceInput;
  session: CommitSession;
  onAnother: () => void;
  onClose: () => void;
  onViewImported: (() => void) | null;
}) {
  const t = sessionTotals(session);
  const attention = rowsNeedingAttention(session);
  const complete = session.state === "done";
  const stats = [
    { label: "Imported", value: t.imported, className: "text-emerald-700 dark:text-emerald-300" },
    { label: "Skipped (duplicates)", value: t.skipped, className: "text-amber-700 dark:text-amber-300" },
    { label: "Failed (errors)", value: t.failed, className: "text-rose-700 dark:text-rose-300" },
    { label: "Excluded by you", value: t.excluded, className: "text-muted-foreground" },
  ];

  return (
    <>
      <DialogHeader className="gap-3">
        <StepTitle className="flex items-center gap-2">
          {complete ? (
            <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
          ) : (
            <AlertTriangle className="size-5 text-amber-600" aria-hidden />
          )}
          {complete ? "Import complete" : "Import stopped"}
        </StepTitle>
        <DialogDescription className="break-all">{source.fileName}</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className={cn("text-2xl font-semibold tabular-nums", s.className)}>{fmt(s.value)}</dd>
          </div>
        ))}
      </dl>

      <div className="-mx-6 min-h-0 flex-1 space-y-3 overflow-y-auto px-6 text-sm">
        {!complete && t.notConfirmed > 0 ? (
          <WarnBox role="alert">
            {plural(t.notConfirmed, "row was", "rows were")} not confirmed as imported. If a batch failed mid-way it may still have been
            saved — check Deliveries before importing these rows again.
          </WarnBox>
        ) : null}
        <div className="space-y-1 text-muted-foreground">
          {t.imported > 0 ? <p>New deliveries are in the dispatch queue with status Created.</p> : null}
          {t.emailsQueued > 0 ? (
            <p>Tracking links are being emailed to {plural(t.emailsQueued, "customer", "customers")}.</p>
          ) : null}
        </div>

        {attention.length ? (
          <section aria-labelledby="import-failed-heading" className="rounded-lg border">
            <div className="flex flex-col gap-2 border-b px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 id="import-failed-heading" className="text-sm font-medium">
                {plural(attention.length, "row needs", "rows need")} attention
              </h3>
              <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => downloadRowsToFix(source, attention)}>
                <Download /> Download rows to fix
              </Button>
            </div>
            <ul className="divide-y text-xs">
              {attention.slice(0, SHOWN_FAILED).map((r) => (
                <li key={r.rowNumber} className="flex gap-3 px-3 py-2">
                  <span className="w-14 shrink-0 tabular-nums text-muted-foreground">Row {r.rowNumber}</span>
                  <span className="min-w-0">
                    <span className="font-medium">{r.raw.recipient_name || r.data.recipientName || "—"}</span>
                    <span className="text-rose-700 dark:text-rose-400"> — {r.errors.map((e) => e.message).join("; ")}</span>
                  </span>
                </li>
              ))}
            </ul>
            {attention.length > SHOWN_FAILED ? (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                and {plural(attention.length - SHOWN_FAILED, "more row", "more rows")} in the download.
              </p>
            ) : null}
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              The download has your original values plus an “error” column. Fix them and import the file again.
            </p>
          </section>
        ) : null}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onAnother}>
          <Upload /> Import more
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onClose}>
            Done
          </Button>
          {onViewImported ? (
            <Button type="button" className="min-h-11 sm:min-h-9" onClick={onViewImported}>
              View imported deliveries
            </Button>
          ) : null}
        </div>
      </DialogFooter>
    </>
  );
}
