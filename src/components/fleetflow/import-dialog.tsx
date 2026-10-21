"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileWarning,
  Info,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";

import { api, useApiData } from "@/lib/api-client";
import { useAppStore, goToSettings } from "@/store/app-store";
import { CSV_MAX_BYTES, CSV_MAX_ROWS } from "@/lib/csv";
import {
  DATE_ONLY_LABEL,
  LIKELY_DUPLICATE_DAYS,
  rowsToFix,
  type ImportRow,
  type ImportRowStatus,
  type ImportTotals,
} from "@/lib/delivery-import";
import { downloadCsv, formatDateTime, truncate } from "@/lib/format";
import { PriorityBadge } from "@/components/fleetflow/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Bulk CSV import: choose file → preview (server-validated) → result.
// The server re-parses and re-validates on every call; this dialog only
// displays what the server returned.
// ─────────────────────────────────────────────────────────────

export const TEMPLATE_URL = "/api/deliveries/import/template";

interface PreviewResponse {
  fileHash: string;
  fileName: string;
  timezone: string;
  alreadyImported: { at: string; by: string } | null;
  fileWarnings: string[];
  totals: ImportTotals;
  rows: ImportRow[];
}

interface CommitResponse {
  batchId: string;
  imported: number;
  skipped: number;
  failed: number;
  emailsQueued: number;
}

interface OrgResponse {
  organization: { defaultPickupAddress: string | null; timezone: string };
}

type Filter = "all" | ImportRowStatus;

const STATUS_BADGE: Record<ImportRowStatus, { label: string; className: string }> = {
  valid: {
    label: "Ready",
    className: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  },
  invalid: {
    label: "Error",
    className: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
  },
  duplicate: {
    label: "Duplicate",
    className: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  },
};

const GUIDE: { column: string; required?: boolean; accepts: string }[] = [
  { column: "order_ref", accepts: "Your order / invoice no. Used to skip orders that were already imported." },
  { column: "recipient_name", required: true, accepts: "2–120 characters" },
  { column: "recipient_phone", required: true, accepts: "e.g. 01711-234567 or +8801711234567" },
  { column: "recipient_email", accepts: "Optional — the customer is emailed their tracking link" },
  { column: "pickup_address", accepts: "Blank = your default pickup address" },
  { column: "delivery_address", required: true, accepts: "5–300 characters" },
  { column: "instructions", accepts: "Up to 500 characters" },
  { column: "priority", accepts: "LOW, NORMAL, HIGH or URGENT (any case). Blank = NORMAL" },
  {
    column: "expected_delivery",
    accepts: `DD/MM/YYYY, DD/MM/YYYY HH:mm, YYYY-MM-DD or YYYY-MM-DD HH:mm (24-hour). A date alone means ${DATE_ONLY_LABEL}.`,
  },
];

/** Read a file as UTF-8; fall back to Windows-1252 (Excel's plain "CSV") with a warning. */
async function readCsvFile(file: File): Promise<{ text: string; legacyEncoding: boolean }> {
  const buf = await file.arrayBuffer();
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), legacyEncoding: false };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buf), legacyEncoding: true };
  }
}

/** CSV of the invalid rows plus an "error" column, ready to fix and re-upload. */
function downloadRowsToFix(preview: PreviewResponse) {
  const base = preview.fileName.replace(/\.csv$/i, "");
  downloadCsv(`${base}-rows-to-fix.csv`, rowsToFix(preview.rows));
}

function StatusPill({ status }: { status: ImportRowStatus }) {
  const s = STATUS_BADGE[status];
  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", s.className)}>
      {s.label}
    </Badge>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
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
  onViewImported?: (batch: { id: string; fileName: string }) => void;
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
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-4xl">
        {/* Mounted only while open, so every opening starts at step 1. */}
        {open ? (
          <ImportFlow
            busy={busy}
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
  busy,
  setBusy,
  onClose,
  onViewImported,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onClose: () => void;
  onViewImported: (batch: { id: string; fileName: string }) => void;
}) {
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "importing">("idle");

  async function handleFile(f: File) {
    setError(null);
    if (!/\.csv$/i.test(f.name)) {
      setError("Only .csv files can be imported. In Excel, use File → Save As → “CSV UTF-8 (Comma delimited)”.");
      return;
    }
    if (f.size > CSV_MAX_BYTES) {
      setError(`This file is ${(f.size / 1024 / 1024).toFixed(1)} MB; the limit is 1 MB. Split it into smaller files and import them one at a time.`);
      return;
    }
    if (f.size === 0) {
      setError("This file is empty.");
      return;
    }
    setBusy(true);
    setPhase("checking");
    try {
      const { text, legacyEncoding } = await readCsvFile(f);
      if (legacyEncoding) {
        toast.warning("This file isn't saved as UTF-8 — Bangla text may look wrong. Save it as “CSV UTF-8” to be safe.");
      }
      const res = await api.post<PreviewResponse>("/api/deliveries/import", { fileName: f.name, csv: text, mode: "preview" });
      setFile({ name: f.name, csv: text });
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check this file");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  async function handleCommit() {
    if (!file || !preview) return;
    setError(null);
    setBusy(true);
    setPhase("importing");
    try {
      const res = await api.post<CommitResponse>("/api/deliveries/import", { fileName: file.name, csv: file.csv, mode: "commit" });
      setResult(res);
      useAppStore.getState().bump();
      toast.success(`Imported ${res.imported} ${res.imported === 1 ? "delivery" : "deliveries"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed — nothing was saved");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  if (result && preview) {
    return <ResultStep result={result} preview={preview} onAnother={reset} onClose={onClose} onViewImported={() => onViewImported({ id: result.batchId, fileName: preview.fileName })} />;
  }
  if (preview && file) {
    return (
      <PreviewStep
        preview={preview}
        importing={phase === "importing"}
        busy={busy}
        error={error}
        onBack={reset}
        onCancel={onClose}
        onCommit={handleCommit}
      />
    );
  }
  return <ChooseStep checking={phase === "checking"} error={error} onFile={handleFile} onCancel={onClose} />;
}

// ── Step 1: choose a file ────────────────────────────────────

function ChooseStep({
  checking,
  error,
  onFile,
  onCancel,
}: {
  checking: boolean;
  error: string | null;
  onFile: (f: File) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { data: orgData } = useApiData<OrgResponse>("/api/org");
  const org = orgData?.organization;

  function pick(files: FileList | null) {
    const f = files?.[0];
    if (f && !checking) onFile(f);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import deliveries from CSV</DialogTitle>
        <DialogDescription>
          Upload a spreadsheet of orders. You&apos;ll see every row checked before anything is saved.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!checking) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
            checking && "opacity-70"
          )}
        >
          {checking ? (
            <>
              <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
              <p className="text-sm font-medium" aria-live="polite">
                Checking your file…
              </p>
            </>
          ) : (
            <>
              <Upload className="size-10 text-muted-foreground" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium">Drag a .csv file here</p>
                <p className="text-xs text-muted-foreground">
                  Up to {CSV_MAX_ROWS.toLocaleString()} rows and 1 MB per file
                </p>
              </div>
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => inputRef.current?.click()}>
                <FileSpreadsheet /> Choose file
              </Button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="CSV file to import"
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            Start from the template — it has the right columns and two example rows.
          </p>
          <Button asChild variant="secondary" size="sm" className="min-h-11 shrink-0 sm:min-h-8">
            <a href={TEMPLATE_URL} download>
              <Download /> Download template
            </a>
          </Button>
        </div>

        {org && !org.defaultPickupAddress ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              No default pickup address is set, so every row needs a pickup_address.{" "}
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => goToSettings("company")}>
                Set one in Settings
              </button>
            </span>
          </div>
        ) : null}

        <details className="group rounded-lg border">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-medium">
            Columns &amp; accepted formats
            <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <div className="space-y-3 border-t px-3 py-3 text-sm">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,11rem)_1fr]">
              {GUIDE.map((g) => (
                <div key={g.column} className="contents">
                  <dt className="font-mono text-xs leading-5">
                    {g.column}
                    {g.required ? <span className="text-destructive"> *</span> : null}
                  </dt>
                  <dd className="text-muted-foreground">
                    {g.column === "pickup_address" && org?.defaultPickupAddress
                      ? `Blank = your default: ${truncate(org.defaultPickupAddress, 60)}`
                      : g.accepts}
                  </dd>
                </div>
              ))}
            </dl>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>The first row must be the header. Column names are matched ignoring case and spaces (e.g. “Phone”, “Order No”).</li>
              <li>
                Dates are read day-first in your organization&apos;s timezone ({org?.timezone ?? "Asia/Dhaka"}); 10/25/2026
                (month first) is rejected, not guessed.
              </li>
              <li>
                Duplicates are skipped: an order_ref used twice in the file or already in FleetFlow, and rows with the same phone,
                address and expected date as another row or a delivery from the last {LIKELY_DUPLICATE_DAYS} days.
              </li>
              <li>Rows with errors are never imported — fix them and upload just those rows again.</li>
            </ul>
          </div>
        </details>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel} disabled={checking}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Step 2: preview ──────────────────────────────────────────

function RowNotes({ row }: { row: ImportRow }) {
  if (!row.errors.length && !row.duplicateOf && !row.warnings.length && !row.data.pickupFromDefault) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {row.errors.map((e, i) => (
        <li key={`e-${i}`} className="flex gap-1 text-rose-700 dark:text-rose-400">
          <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{e.message}</span>
        </li>
      ))}
      {row.duplicateOf ? (
        <li className="flex gap-1 text-amber-700 dark:text-amber-400">
          <Copy className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {row.duplicateOf.reason} — skipped
            {row.duplicateOf.trackingCode ? <span className="ml-1 font-mono">({row.duplicateOf.trackingCode})</span> : null}
          </span>
        </li>
      ) : null}
      {row.warnings.map((w, i) => (
        <li key={`w-${i}`} className="flex gap-1 text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{w}</span>
        </li>
      ))}
      {row.data.pickupFromDefault && row.status !== "invalid" ? (
        <li className="text-muted-foreground">Pickup: default address</li>
      ) : null}
    </ul>
  );
}

function PreviewStep({
  preview,
  importing,
  busy,
  error,
  onBack,
  onCancel,
  onCommit,
}: {
  preview: PreviewResponse;
  importing: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const { totals, rows } = preview;
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const blocked = !!preview.alreadyImported;
  const canImport = totals.valid > 0 && !blocked && !busy;

  const tabs: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: totals.rows },
    { value: "valid", label: "Ready", count: totals.valid },
    { value: "invalid", label: "Errors", count: totals.invalid },
    { value: "duplicate", label: "Duplicates", count: totals.duplicates },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Review import</DialogTitle>
        <DialogDescription className="break-all">
          <FileSpreadsheet className="mr-1 inline size-4 align-text-bottom" aria-hidden />
          {preview.fileName} · {totals.rows} {totals.rows === 1 ? "row" : "rows"}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-3 gap-2 text-center" aria-live="polite">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{totals.valid}</p>
          <p className="text-xs text-muted-foreground">ready to import</p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 dark:border-rose-900 dark:bg-rose-950/40">
          <p className="text-xl font-semibold tabular-nums text-rose-700 dark:text-rose-300">{totals.invalid}</p>
          <p className="text-xs text-muted-foreground">with errors</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">{totals.duplicates}</p>
          <p className="text-xs text-muted-foreground">duplicates (skipped)</p>
        </div>
      </div>

      {blocked ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            This exact file was already imported on {formatDateTime(preview.alreadyImported!.at)} by{" "}
            {preview.alreadyImported!.by}. Importing it again is blocked to prevent duplicate deliveries.
          </span>
        </div>
      ) : null}

      {preview.fileWarnings.map((w) => (
        <p key={w} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" aria-hidden /> {w}
        </p>
      ))}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList className="w-full sm:w-fit">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="min-h-9 px-3">
              {t.label}
              <span className="ml-1 text-xs tabular-nums text-muted-foreground">{t.count}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="-mx-6 min-h-0 flex-1 overflow-auto border-y px-0 sm:mx-0 sm:rounded-lg sm:border">
        {shown.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No rows in this group.</p>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-14">Row</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Delivery address</TableHead>
                <TableHead className="hidden md:table-cell">Expected</TableHead>
                <TableHead className="hidden sm:table-cell">Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.rowNumber} className="align-top">
                  <TableCell className="tabular-nums text-muted-foreground">{r.rowNumber}</TableCell>
                  <TableCell>
                    <StatusPill status={r.status} />
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal">
                    <p className="font-medium">{r.data.recipientName || <span className="text-muted-foreground">—</span>}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.data.recipientPhone || "no phone"}
                      {r.data.externalRef ? <span className="ml-1 font-mono">· {truncate(r.data.externalRef, 24)}</span> : null}
                    </p>
                    <RowNotes row={r} />
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal text-sm">
                    {r.data.deliveryAddress ? truncate(r.data.deliveryAddress, 90) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm md:table-cell">
                    {r.data.expectedLocal ?? (r.raw.expected_delivery ? <span className="text-rose-700 dark:text-rose-400">{r.raw.expected_delivery}</span> : "—")}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {r.status === "invalid" && r.errors.some((e) => e.field === "priority") ? (
                      <span className="text-sm text-rose-700 dark:text-rose-400">{r.raw.priority}</span>
                    ) : (
                      <PriorityBadge priority={r.data.priority} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <DialogFooter className="gap-2 sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onBack} disabled={busy}>
            <ArrowLeft /> Choose another file
          </Button>
          {totals.invalid > 0 ? (
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => downloadRowsToFix(preview)}>
              <Download /> Rows with errors
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" className="min-h-11 sm:min-h-9" onClick={onCommit} disabled={!canImport}>
            {importing ? <Loader2 className="animate-spin" /> : <Upload />}
            {importing
              ? `Importing ${totals.valid}…`
              : `Import ${totals.valid} ${totals.valid === 1 ? "delivery" : "deliveries"}`}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

// ── Step 3: result ───────────────────────────────────────────

function ResultStep({
  result,
  preview,
  onAnother,
  onClose,
  onViewImported,
}: {
  result: CommitResponse;
  preview: PreviewResponse;
  onAnother: () => void;
  onClose: () => void;
  onViewImported: () => void;
}) {
  const stats = [
    { label: "Imported", value: result.imported, className: "text-emerald-700 dark:text-emerald-300" },
    { label: "Skipped (duplicates)", value: result.skipped, className: "text-amber-700 dark:text-amber-300" },
    { label: "Failed (errors)", value: result.failed, className: "text-rose-700 dark:text-rose-300" },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> Import complete
        </DialogTitle>
        <DialogDescription className="break-all">{preview.fileName}</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-3 gap-2 text-center">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border p-3">
            <dd className={cn("text-2xl font-semibold tabular-nums", s.className)}>{s.value}</dd>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
          </div>
        ))}
      </dl>

      <div className="space-y-2 text-sm text-muted-foreground">
        <p>New deliveries are in the dispatch queue with status Created.</p>
        {result.emailsQueued > 0 ? (
          <p>
            Tracking links are being emailed to {result.emailsQueued} {result.emailsQueued === 1 ? "customer" : "customers"}.
          </p>
        ) : null}
        {result.failed > 0 ? (
          <p>
            {result.failed} {result.failed === 1 ? "row was" : "rows were"} not imported. Download them with an extra “error”
            column, fix them, and upload that file.
          </p>
        ) : null}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          {result.failed > 0 ? (
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => downloadRowsToFix(preview)}>
              <Download /> Download rows to fix
            </Button>
          ) : null}
          <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onAnother}>
            <Upload /> Import another file
          </Button>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onClose}>
            Done
          </Button>
          <Button type="button" className="min-h-11 sm:min-h-9" onClick={onViewImported}>
            View imported deliveries
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

export default ImportDialog;
