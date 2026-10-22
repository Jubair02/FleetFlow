"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";

import { api, ApiRequestError, useApiData } from "@/lib/api-client";
import { useAppStore, goToSettings } from "@/store/app-store";
import { isOverridableDuplicate, type ImportColumn, type ImportRow } from "@/lib/delivery-import";
import {
  MAX_COMMIT_ROWS,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type MappedRow,
} from "@/lib/import-contract";
import { isPlanRefusal, UpgradeExplainer, useOrgPlanInfo } from "@/components/fleetflow/plan-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { buildMappedRows, chunk, headerSignature, rememberMapping, type ParsedSource } from "./import/parse";
import { initialMapping, MappingStep, type MappingState } from "./import/mapping-step";
import { classifyRow, ReviewStep, type ReviewActions, type ReviewModel } from "./import/review-step";
import { CommitStep, downloadRowsToFix, sessionTotals, SummaryStep, type CommitSession } from "./import/commit-steps";
import { SourceStep } from "./import/source-step";
import { plural, TEMPLATE_URL, type OrgResponse, type SourceInput } from "./import/shared";

// ─────────────────────────────────────────────────────────────
// Bulk import: source (CSV upload or paste) → map columns → review
// (editable, server-validated) → chunked commit → summary.
// The server re-validates every row on every preview and commit; this
// dialog never imports a row the server hasn't checked in its current form.
// ─────────────────────────────────────────────────────────────

export { TEMPLATE_URL };

const IMPORT_URL = "/api/deliveries/import";

/** null = several batches were created: show the newest deliveries instead of one batch. */
export type ImportedBatch = { id: string; fileName: string } | null;

type Step = "source" | "map" | "review" | "commit" | "summary";

function newSessionKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof TypeError) return "Couldn't reach FleetFlow — check your connection.";
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Network errors, timeouts, rate limits and 5xx are worth retrying with the same keys. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiRequestError)) return true;
  return err.status >= 500 || err.status === 408 || err.status === 429;
}

// ── Public component ─────────────────────────────────────────

export function ImportDialog({
  open,
  onOpenChange,
  onViewImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Called by "View imported deliveries" after the dialog closes. */
  onViewImported?: (batch: ImportedBatch) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy && !o) return;
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-4 sm:max-w-4xl sm:has-[[data-import-wide]]:h-[90vh] sm:has-[[data-import-wide]]:max-w-[min(96vw,80rem)]"
        onInteractOutside={(e) => {
          // A stray click next to the wide review table shouldn't throw away the user's edits.
          e.preventDefault();
        }}
      >
        {/* Mounted only while open, so every opening starts at step 1. */}
        {open ? (
          <ImportFlow
            setBusy={setBusy}
            onClose={() => onOpenChange(false)}
            onViewImported={(batch) => {
              onOpenChange(false);
              onViewImported?.(batch);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── Flow ─────────────────────────────────────────────────────

function ImportFlow({
  setBusy,
  onClose,
  onViewImported,
}: {
  setBusy: (b: boolean) => void;
  onClose: () => void;
  onViewImported: (batch: ImportedBatch) => void;
}) {
  // CSV import is a plan feature: known-missing from /api/org, or refused by the server (403).
  const { planInfo, locked } = useOrgPlanInfo();
  const { data: orgData } = useApiData<OrgResponse>("/api/org");
  const org = orgData?.organization;

  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<SourceInput | null>(null);
  const [parsed, setParsed] = useState<ParsedSource | null>(null);
  const [mapState, setMapState] = useState<MappingState | null>(null);
  const [model, setModel] = useState<ReviewModel | null>(null);
  /** Rows the user has edited at all (to warn before discarding). */
  const [touched, setTouched] = useState(0);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [session, setSession] = useState<CommitSession | null>(null);

  // ── preview ────────────────────────────────────────────────

  async function postPreview(rows: MappedRow[]): Promise<ImportPreviewResponse | null> {
    if (!source) return null;
    setChecking(true);
    setBusy(true);
    setError(null);
    try {
      return await api.post<ImportPreviewResponse>(IMPORT_URL, {
        mode: "preview",
        source: source.kind,
        fileName: source.fileName,
        rows,
      });
    } catch (err) {
      if (isPlanRefusal(err)) setRefusal(err.message);
      else {
        const msg = errorMessage(err, "Couldn't check these rows");
        setError(msg);
        toast.error(msg);
      }
      return null;
    } finally {
      setChecking(false);
      setBusy(false);
    }
  }

  async function handleMapped(state: MappingState) {
    if (!parsed) return;
    setMapState(state);
    rememberMapping(headerSignature(parsed.records, state.hasHeader, parsed.columnCount), state.mapping);
    const rows = buildMappedRows(parsed.records, state.hasHeader, state.mapping);
    const res = await postPreview(rows);
    if (!res) return;
    setModel({
      preview: res,
      rows,
      verdicts: new Map(res.rows.map((r) => [r.rowNumber, r])),
      dirty: new Set(),
      excluded: new Set(),
      allowDup: new Set(),
      needsRecheck: false,
    });
    setTouched(0);
    setStep("review");
  }

  async function handleRecheck() {
    if (!model) return;
    const sent = model.rows.filter((r) => !model.excluded.has(r.rowNumber));
    if (!sent.length) {
      setError("Every row is excluded — include at least one row to import.");
      return;
    }
    const res = await postPreview(sent);
    if (!res) return;
    setModel((m) => {
      if (!m) return m;
      const verdicts = new Map(m.verdicts);
      for (const r of res.rows) verdicts.set(r.rowNumber, r);
      const sentSet = new Set(sent.map((r) => r.rowNumber));
      const dirty = new Set([...m.dirty].filter((n) => !sentSet.has(n)));
      // Keep "Import anyway" only where the row is still a likely duplicate.
      const allowDup = new Set([...m.allowDup].filter((n) => {
        const v = verdicts.get(n);
        return !!v && isOverridableDuplicate(v);
      }));
      return { ...m, preview: res, verdicts, dirty, allowDup, needsRecheck: false };
    });
    const invalid = res.rows.filter((r) => r.status === "invalid").length;
    if (invalid) toast.warning(`Checked — ${plural(invalid, "row still has", "rows still have")} errors`);
    else toast.success("Checked — no errors");
  }

  // ── review edits (stable callbacks so memoized rows don't re-render) ──

  const onEdit = useCallback((rowNumber: number, col: ImportColumn, value: string) => {
    setModel((m) => {
      if (!m) return m;
      const rows = m.rows.map((r) => (r.rowNumber === rowNumber ? { ...r, values: { ...r.values, [col]: value } } : r));
      const dirty = m.dirty.has(rowNumber) ? m.dirty : new Set(m.dirty).add(rowNumber);
      return { ...m, rows, dirty };
    });
    setTouched((t) => t + 1);
  }, []);

  const onToggleExclude = useCallback((rowNumber: number) => {
    setModel((m) => {
      if (!m) return m;
      const excluded = new Set(m.excluded);
      let dirty = m.dirty;
      const including = excluded.has(rowNumber);
      if (including) excluded.delete(rowNumber);
      else excluded.add(rowNumber);
      // Re-including a row the server didn't see in the last check → it must be checked.
      if (including && !m.preview.rows.some((r) => r.rowNumber === rowNumber)) dirty = new Set(dirty).add(rowNumber);
      // Other rows' duplicate status may hinge on this one; and a blocked
      // "already imported" verdict only changes when the server sees the new set.
      const affectsOthers = m.preview.rows.some(
        (r) => r.rowNumber !== rowNumber && r.duplicateOf?.rowNumber === rowNumber && !excluded.has(r.rowNumber)
      );
      const needsRecheck = m.needsRecheck || affectsOthers || !!m.preview.alreadyImported;
      return { ...m, excluded, dirty, needsRecheck };
    });
  }, []);

  const onToggleAllowDup = useCallback((rowNumber: number) => {
    setModel((m) => {
      if (!m) return m;
      const allowDup = new Set(m.allowDup);
      if (!allowDup.delete(rowNumber)) allowDup.add(rowNumber);
      return { ...m, allowDup };
    });
  }, []);

  const [actions] = useState<ReviewActions>(() => ({ onEdit, onToggleExclude, onToggleAllowDup }));

  function downloadReviewErrors() {
    if (!model || !source) return;
    const rows: ImportRow[] = [];
    for (const r of model.rows) {
      const v = model.verdicts.get(r.rowNumber);
      if (v && classifyRow(model, r.rowNumber, v) === "invalid") rows.push(v);
    }
    downloadRowsToFix(source, rows);
  }

  // ── commit ─────────────────────────────────────────────────

  async function runSession(start: CommitSession) {
    if (!source) return;
    let cur: CommitSession = { ...start, state: "running", error: null };
    setSession(cur);
    setBusy(true);
    for (let i = 0; i < cur.chunks.length; i++) {
      if (cur.results[i]) continue;
      const c = cur.chunks[i];
      try {
        const res = await api.post<ImportCommitResponse>(IMPORT_URL, {
          mode: "commit",
          source: source.kind,
          fileName: source.fileName,
          rows: c.rows,
          idempotencyKey: `${cur.sessionKey}:${i}`,
          allowLikelyDuplicates: c.allowLikelyDuplicates,
        });
        const results = cur.results.slice();
        results[i] = res;
        cur = { ...cur, results };
        setSession(cur);
      } catch (err) {
        const retryable = isRetryable(err);
        const msg = errorMessage(err, "The import was interrupted");
        cur = {
          ...cur,
          state: retryable ? "failed" : "refused",
          error: retryable ? `Batch ${i + 1} of ${cur.chunks.length} didn't finish: ${msg}` : msg,
        };
        setSession(cur);
        setBusy(false);
        if (sessionTotals(cur).imported > 0) useAppStore.getState().bump();
        toast.error(retryable ? "Import interrupted — you can retry" : msg);
        return;
      }
    }
    cur = { ...cur, state: "done" };
    setSession(cur);
    setBusy(false);
    useAppStore.getState().bump();
    const t = sessionTotals(cur);
    toast.success(`Imported ${plural(t.imported, "delivery", "deliveries")}`);
    setStep("summary");
  }

  function handleImport() {
    if (!model) return;
    const toSend: MappedRow[] = [];
    const allow = new Set<number>();
    const invalidRows: number[] = [];
    let duplicatesSkipped = 0;
    for (const r of model.rows) {
      const cls = classifyRow(model, r.rowNumber, model.verdicts.get(r.rowNumber));
      if (cls === "valid" || cls === "override") {
        toSend.push(r);
        if (cls === "override") allow.add(r.rowNumber);
      } else if (cls === "invalid") invalidRows.push(r.rowNumber);
      else if (cls === "duplicate") duplicatesSkipped++;
    }
    if (!toSend.length) return;
    const chunks = chunk(toSend, MAX_COMMIT_ROWS).map((rows) => ({
      rows,
      allowLikelyDuplicates: rows.filter((r) => allow.has(r.rowNumber)).map((r) => r.rowNumber),
    }));
    const s: CommitSession = {
      sessionKey: newSessionKey(),
      chunks,
      results: chunks.map(() => null),
      state: "running",
      error: null,
      snapshot: { verdicts: model.verdicts, invalidRows, duplicatesSkipped, excluded: model.excluded.size },
    };
    setStep("commit");
    void runSession(s);
  }

  function stopSession() {
    if (!session) return;
    setSession({ ...session, state: session.state === "done" ? "done" : "stopped" });
    setStep("summary");
  }

  // ── navigation ─────────────────────────────────────────────

  function startOver() {
    setStep("source");
    setSource(null);
    setParsed(null);
    setMapState(null);
    setModel(null);
    setSession(null);
    setTouched(0);
    setError(null);
  }

  function backFromReview() {
    if (touched > 0 && !window.confirm("Go back to the columns? Your edits in the review table will be discarded.")) return;
    setError(null);
    setModel(null);
    setStep("map");
  }

  // ── render ─────────────────────────────────────────────────

  if (refusal !== null || (locked("csv_import") && step !== "summary" && step !== "commit")) {
    return <LockedStep planName={planInfo?.name} message={refusal} onClose={onClose} />;
  }

  if (step === "summary" && session && source) {
    const { batchIds } = sessionTotals(session);
    return (
      <SummaryStep
        source={source}
        session={session}
        onAnother={startOver}
        onClose={onClose}
        onViewImported={
          batchIds.length === 0
            ? null
            : () => onViewImported(batchIds.length === 1 ? { id: batchIds[0], fileName: source.fileName } : null)
        }
      />
    );
  }

  if (step === "commit" && session) {
    return (
      <CommitStep
        session={session}
        onRetry={() => void runSession(session)}
        onStop={stopSession}
        onBackToReview={() => {
          setSession(null);
          setStep("review");
        }}
      />
    );
  }

  if (step === "review" && model && source) {
    return (
      <ReviewStep
        source={source}
        model={model}
        org={org}
        checking={checking}
        error={error}
        actions={actions}
        onRecheck={handleRecheck}
        onImport={handleImport}
        onDownloadErrors={downloadReviewErrors}
        onBack={backFromReview}
        onCancel={onClose}
      />
    );
  }

  if (step === "map" && source && parsed) {
    return (
      <MappingStep
        source={source}
        parsed={parsed}
        initial={mapState ?? initialMapping(parsed)}
        org={org}
        checking={checking}
        error={error}
        onBack={() => {
          setError(null);
          setStep("source");
        }}
        onCancel={onClose}
        onNext={handleMapped}
      />
    );
  }

  return (
    <SourceStep
      initial={source}
      org={org}
      onCancel={onClose}
      onNext={(s, p) => {
        setSource(s);
        setParsed(p);
        setMapState(initialMapping(p));
        setError(null);
        setStep("map");
      }}
    />
  );
}

// ── Plan doesn't include CSV import ──────────────────────────

function LockedStep({ planName, message, onClose }: { planName?: string | null; message: string | null; onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Upgrade to import deliveries</DialogTitle>
        <DialogDescription>Bring in a whole day&apos;s orders from a spreadsheet in one go.</DialogDescription>
      </DialogHeader>
      <UpgradeExplainer feature="csv_import" planName={planName} message={message} />
      <p className="text-sm text-muted-foreground">Until then, you can add deliveries one at a time with “New delivery”.</p>
      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onClose}>
          Close
        </Button>
        <Button
          type="button"
          className="min-h-11 sm:min-h-9"
          onClick={() => {
            onClose();
            goToSettings("plan");
          }}
        >
          <CreditCard /> See plans
        </Button>
      </DialogFooter>
    </>
  );
}

export default ImportDialog;
