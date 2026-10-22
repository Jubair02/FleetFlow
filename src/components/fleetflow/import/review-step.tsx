"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardPaste,
  Copy,
  Download,
  FileSpreadsheet,
  FileWarning,
  Info,
  Loader2,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";

import { PRIORITIES } from "@/lib/constants";
import { COLUMN_LABELS, isOverridableDuplicate, REQUIRED_COLUMNS, type ImportColumn, type ImportRow, type ImportRowStatus } from "@/lib/delivery-import";
import type { ImportPreviewResponse, MappedRow } from "@/lib/import-contract";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  ErrorBox,
  PAGE_SIZE,
  StatusPill,
  StepTitle,
  Stepper,
  WarnBox,
  fmt,
  isLikelyDuplicate,
  plural,
  type OrgResponse,
  type PillStatus,
  type SourceInput,
} from "./shared";

// ─────────────────────────────────────────────────────────────
// Step 3 — editable preview. Every value shown comes from the working copy
// of the mapped rows; statuses and errors come from the server's last
// preview. Any edit marks the row "Re-check" and blocks importing until the
// server has validated it again.
// ─────────────────────────────────────────────────────────────

export interface ReviewModel {
  preview: ImportPreviewResponse;
  rows: MappedRow[];
  /** Latest server verdict per row number (kept for excluded rows too). */
  verdicts: Map<number, ImportRow>;
  /** Rows edited (or otherwise affected) since the last check. */
  dirty: Set<number>;
  excluded: Set<number>;
  /** Likely duplicates the user chose to import anyway. */
  allowDup: Set<number>;
  /** Exclusions changed something only the server can re-decide (e.g. which copy is the duplicate). */
  needsRecheck: boolean;
}

export type RowClass = "valid" | "invalid" | "duplicate" | "override" | "excluded";

/** Where a row ends up if the user imports now (ignoring pending edits). */
export function classifyRow(m: Pick<ReviewModel, "excluded" | "allowDup">, rowNumber: number, verdict: ImportRow | undefined): RowClass {
  if (m.excluded.has(rowNumber)) return "excluded";
  if (!verdict) return "invalid";
  if (verdict.status === "duplicate") {
    return isOverridableDuplicate(verdict) && m.allowDup.has(rowNumber) ? "override" : "duplicate";
  }
  return verdict.status;
}

type Filter = "all" | ImportRowStatus | "excluded";

/** Editable cells, in display order. */
const EDIT_COLUMNS: ImportColumn[] = [
  "recipient_name",
  "recipient_phone",
  "recipient_email",
  "pickup_address",
  "delivery_address",
  "priority",
  "expected_delivery",
  "order_ref",
  "instructions",
];

const COLUMN_WIDTH: Record<ImportColumn, string> = {
  order_ref: "w-32",
  recipient_name: "w-40",
  recipient_phone: "w-36",
  recipient_email: "w-48",
  pickup_address: "w-56",
  delivery_address: "w-64",
  instructions: "w-56",
  priority: "w-28",
  expected_delivery: "w-40",
};

const INPUT_CLASS =
  "h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none transition-[color,box-shadow] " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 disabled:opacity-60";

export interface ReviewActions {
  onEdit: (rowNumber: number, col: ImportColumn, value: string) => void;
  onToggleExclude: (rowNumber: number) => void;
  onToggleAllowDup: (rowNumber: number) => void;
}

export function ReviewStep({
  source,
  model,
  org,
  checking,
  error,
  actions,
  onRecheck,
  onImport,
  onDownloadErrors,
  onBack,
  onCancel,
}: {
  source: SourceInput;
  model: ReviewModel;
  org: OrgResponse["organization"] | undefined;
  checking: boolean;
  error: string | null;
  actions: ReviewActions;
  onRecheck: () => void;
  onImport: () => void;
  onDownloadErrors: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const { preview, rows, verdicts, dirty, excluded } = model;
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const classes = useMemo(() => {
    const out = new Map<number, RowClass>();
    const sets = { excluded: model.excluded, allowDup: model.allowDup };
    for (const r of rows) out.set(r.rowNumber, classifyRow(sets, r.rowNumber, verdicts.get(r.rowNumber)));
    return out;
  }, [rows, verdicts, model.excluded, model.allowDup]);

  const counts = useMemo(() => {
    const c = { all: rows.length, ready: 0, invalid: 0, duplicate: 0, excluded: 0, statusValid: 0, statusInvalid: 0, statusDup: 0 };
    for (const r of rows) {
      const k = classes.get(r.rowNumber)!;
      if (k === "valid" || k === "override") c.ready++;
      else if (k === "invalid") c.invalid++;
      else if (k === "duplicate") c.duplicate++;
      else c.excluded++;
      const s = verdicts.get(r.rowNumber)?.status;
      if (s === "valid") c.statusValid++;
      else if (s === "duplicate") c.statusDup++;
      else c.statusInvalid++;
    }
    return c;
  }, [rows, classes, verdicts]);

  const shown = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "excluded") return rows.filter((r) => excluded.has(r.rowNumber));
    return rows.filter((r) => (verdicts.get(r.rowNumber)?.status ?? "invalid") === filter);
  }, [rows, filter, verdicts, excluded]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = shown.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [safePage, filter]);

  // Edits to excluded rows don't matter until they are included again.
  const pending = useMemo(() => [...dirty].filter((n) => !excluded.has(n)).length, [dirty, excluded]);
  const stale = pending > 0 || model.needsRecheck;
  const blocked = !!preview.alreadyImported;
  const remaining = preview.monthlyDeliveriesRemaining;
  const overAllowance = remaining !== null && counts.ready > remaining;
  const canImport = !checking && !stale && !blocked && counts.ready > 0 && remaining !== 0;
  const pickupDefault = org?.defaultPickupAddress ?? null;

  const tabs: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "valid", label: "Ready", count: counts.statusValid },
    { value: "invalid", label: "Errors", count: counts.statusInvalid },
    { value: "duplicate", label: "Duplicates", count: counts.statusDup },
    ...(counts.excluded ? [{ value: "excluded" as const, label: "Excluded", count: counts.excluded }] : []),
  ];

  const recheckLabel = pending ? `Re-check ${plural(pending, "edited row", "edited rows")}` : "Re-check rows";

  return (
    <>
      <DialogHeader className="gap-3" data-import-wide="">
        <Stepper current={2} />
        <StepTitle>Review import</StepTitle>
        <DialogDescription className="break-all">
          {source.kind === "PASTE" ? (
            <ClipboardPaste className="mr-1 inline size-4 align-text-bottom" aria-hidden />
          ) : (
            <FileSpreadsheet className="mr-1 inline size-4 align-text-bottom" aria-hidden />
          )}
          {source.fileName} · {plural(rows.length, "row", "rows")} · edit any cell, then re-check before importing
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4" aria-live="polite">
        <Stat value={counts.ready} label="ready to import" tone="emerald" />
        <Stat value={counts.invalid} label="with errors" tone="rose" />
        <Stat value={counts.duplicate} label="duplicates (skipped)" tone="amber" />
        <Stat value={counts.excluded} label="excluded by you" tone="muted" />
      </div>

      <div className="space-y-2">
        {stale ? (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-md border border-sky-300/70 bg-sky-50 px-3 py-2 text-sm text-sky-900 sm:flex-row sm:items-center sm:justify-between dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
          >
            <span className="flex items-start gap-2">
              <RefreshCw className="mt-0.5 size-4 shrink-0" aria-hidden />
              {pending
                ? `You changed ${plural(pending, "row", "rows")}. Re-check before importing — every row is validated again by FleetFlow.`
                : "Your exclusions change which rows count as duplicates. Re-check before importing."}
            </span>
            <Button type="button" size="sm" className="min-h-11 shrink-0 sm:min-h-8" onClick={onRecheck} disabled={checking}>
              {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {checking ? "Checking…" : recheckLabel}
            </Button>
          </div>
        ) : null}

        {blocked ? (
          <WarnBox icon={FileWarning} role="alert">
            These exact rows were already imported on {formatDateTime(preview.alreadyImported!.at)} by {preview.alreadyImported!.by}.
            Importing them again is blocked to prevent duplicate deliveries.
          </WarnBox>
        ) : null}

        {remaining !== null && (overAllowance || remaining === 0) ? (
          <WarnBox role="alert">
            {remaining === 0
              ? "Your plan's monthly delivery allowance is used up, so nothing can be imported right now. Upgrade your plan or wait for next month."
              : `Your plan has room for ${plural(remaining, "more delivery", "more deliveries")} this month, but ${fmt(counts.ready)} are ready to import. Exclude ${fmt(counts.ready - remaining)} or upgrade — otherwise the import stops at the batch that goes over the allowance.`}
          </WarnBox>
        ) : null}
      </div>

      <Tabs
        value={filter}
        onValueChange={(v) => {
          setFilter(v as Filter);
          setPage(0);
        }}
      >
        <TabsList className="h-auto w-full flex-wrap sm:w-fit">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="min-h-9 px-3">
              {t.label}
              <span className="ml-1 text-xs tabular-nums text-muted-foreground">{fmt(t.count)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div
        ref={scrollRef}
        className="-mx-6 min-h-48 flex-1 overflow-auto border-y sm:mx-0 sm:rounded-lg sm:border"
        aria-busy={checking || undefined}
      >
        {shown.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No rows in this group.</p>
        ) : (
          <fieldset disabled={checking} className="contents">
            <legend className="sr-only">Rows to import</legend>
            <table className="w-max min-w-full caption-bottom border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-20 bg-background">
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="sticky left-0 z-10 w-36 border-b bg-background px-2 py-2 font-medium">
                    Row
                  </th>
                  {EDIT_COLUMNS.map((c) => (
                    <th key={c} scope="col" className={cn("border-b px-1.5 py-2 font-medium whitespace-nowrap", COLUMN_WIDTH[c])}>
                      {COLUMN_LABELS[c]}
                      {REQUIRED_COLUMNS.includes(c) || (c === "pickup_address" && !pickupDefault && !!org) ? (
                        <span className="text-destructive" aria-hidden>
                          {" "}*
                        </span>
                      ) : null}
                    </th>
                  ))}
                  <th scope="col" className="w-80 border-b px-2 py-2 font-medium">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <ReviewRow
                    key={r.rowNumber}
                    row={r}
                    verdict={verdicts.get(r.rowNumber)}
                    cls={classes.get(r.rowNumber)!}
                    dirty={dirty.has(r.rowNumber)}
                    pickupDefault={pickupDefault}
                    actions={actions}
                  />
                ))}
              </tbody>
            </table>
          </fieldset>
        )}
      </div>

      {shown.length > PAGE_SIZE ? (
        <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Preview pages">
          <p className="text-muted-foreground tabular-nums" aria-live="polite">
            Rows {fmt(safePage * PAGE_SIZE + 1)}–{fmt(Math.min(shown.length, (safePage + 1) * PAGE_SIZE))} of {fmt(shown.length)}
          </p>
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" className="size-11 sm:size-8" onClick={() => setPage(0)} disabled={safePage === 0} aria-label="First page">
              <ChevronsLeft />
            </Button>
            <Button type="button" variant="outline" size="icon" className="size-11 sm:size-8" onClick={() => setPage(safePage - 1)} disabled={safePage === 0} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="px-2 text-xs text-muted-foreground tabular-nums">
              Page {fmt(safePage + 1)} of {fmt(pageCount)}
            </span>
            <Button type="button" variant="outline" size="icon" className="size-11 sm:size-8" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1} aria-label="Next page">
              <ChevronRight />
            </Button>
            <Button type="button" variant="outline" size="icon" className="size-11 sm:size-8" onClick={() => setPage(pageCount - 1)} disabled={safePage >= pageCount - 1} aria-label="Last page">
              <ChevronsRight />
            </Button>
          </div>
        </nav>
      ) : null}

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <DialogFooter className="gap-2 sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onBack} disabled={checking}>
            <ArrowLeft /> Columns
          </Button>
          {counts.invalid > 0 ? (
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onDownloadErrors}>
              <Download /> Rows with errors
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel} disabled={checking}>
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11 sm:min-h-9"
            onClick={onImport}
            disabled={!canImport}
            title={stale ? "Re-check your changes first" : undefined}
          >
            <Upload />
            {`Import ${plural(counts.ready, "delivery", "deliveries")}`}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: "emerald" | "rose" | "amber" | "muted" }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 [&>p:first-child]:text-emerald-700 dark:[&>p:first-child]:text-emerald-300",
    rose: "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 [&>p:first-child]:text-rose-700 dark:[&>p:first-child]:text-rose-300",
    amber: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 [&>p:first-child]:text-amber-700 dark:[&>p:first-child]:text-amber-300",
    muted: "bg-muted/40 [&>p:first-child]:text-muted-foreground",
  } as const;
  return (
    <div className={cn("rounded-lg border p-2", tones[tone])}>
      <p className="text-xl font-semibold tabular-nums">{fmt(value)}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ── One editable row ─────────────────────────────────────────

const ReviewRow = memo(function ReviewRow({
  row,
  verdict,
  cls,
  dirty,
  pickupDefault,
  actions,
}: {
  row: MappedRow;
  verdict: ImportRow | undefined;
  cls: RowClass;
  dirty: boolean;
  pickupDefault: string | null;
  actions: ReviewActions;
}) {
  const n = row.rowNumber;
  const isExcluded = cls === "excluded";
  const pill: PillStatus = isExcluded ? "excluded" : dirty ? "changed" : cls;
  const errorFor = (c: ImportColumn) => verdict?.errors.find((e) => e.field === c)?.message;

  return (
    <tr className={cn("align-top", isExcluded && "[&>td]:opacity-60", cls === "invalid" && !isExcluded && "bg-rose-50/40 dark:bg-rose-950/10")}>
      <th scope="row" className="sticky left-0 z-10 border-b bg-background px-2 py-2 text-left font-normal">
        <div className="flex items-start gap-2">
          <Checkbox
            checked={!isExcluded}
            onCheckedChange={() => actions.onToggleExclude(n)}
            aria-label={isExcluded ? `Include row ${n} in the import` : `Exclude row ${n} from the import`}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <span className="block text-xs tabular-nums text-muted-foreground">Row {n}</span>
            <StatusPill status={pill} />
          </div>
        </div>
      </th>
      {EDIT_COLUMNS.map((c) => (
        <Cell
          key={c}
          rowNumber={n}
          col={c}
          value={row.values[c] ?? ""}
          error={errorFor(c)}
          hint={
            c === "expected_delivery" && !dirty && verdict?.data.expectedLocal && verdict.data.expectedLocal !== (row.values[c] ?? "").trim()
              ? `= ${verdict.data.expectedLocal}`
              : undefined
          }
          placeholder={c === "pickup_address" && pickupDefault ? "Default pickup" : c === "priority" ? undefined : "—"}
          onEdit={actions.onEdit}
        />
      ))}
      <td className="w-80 border-b px-2 py-2 align-top">
        <RowNotes rowNumber={n} verdict={verdict} cls={cls} dirty={dirty} onToggleAllowDup={actions.onToggleAllowDup} />
      </td>
    </tr>
  );
});

function Cell({
  rowNumber,
  col,
  value,
  error,
  hint,
  placeholder,
  onEdit,
}: {
  rowNumber: number;
  col: ImportColumn;
  value: string;
  error: string | undefined;
  hint?: string;
  placeholder?: string;
  onEdit: ReviewActions["onEdit"];
}) {
  const label = `Row ${rowNumber}, ${COLUMN_LABELS[col]}`;
  const errId = error ? `imp-err-${rowNumber}-${col}` : undefined;
  const upper = value.trim().toUpperCase();
  const knownPriority = !upper || (PRIORITIES as readonly string[]).includes(upper);

  return (
    <td className={cn("border-b px-1.5 py-2", COLUMN_WIDTH[col])}>
      {col === "priority" ? (
        <select
          className={cn(INPUT_CLASS, "pr-1")}
          value={knownPriority ? upper : value}
          onChange={(e) => onEdit(rowNumber, col, e.target.value)}
          aria-label={label}
          aria-invalid={!!error || undefined}
          aria-describedby={errId}
        >
          <option value="">Normal (blank)</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
          {!knownPriority ? <option value={value}>{value} (invalid)</option> : null}
        </select>
      ) : (
        <input
          type="text"
          className={INPUT_CLASS}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onEdit(rowNumber, col, e.target.value)}
          aria-label={label}
          aria-invalid={!!error || undefined}
          aria-describedby={errId}
          title={value.length > 30 ? value : undefined}
          inputMode={col === "recipient_phone" ? "tel" : col === "recipient_email" ? "email" : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {error ? (
        <p id={errId} className="mt-1 text-xs leading-snug text-rose-700 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">{hint}</p>
      ) : null}
    </td>
  );
}

function RowNotes({
  rowNumber,
  verdict,
  cls,
  dirty,
  onToggleAllowDup,
}: {
  rowNumber: number;
  verdict: ImportRow | undefined;
  cls: RowClass;
  dirty: boolean;
  onToggleAllowDup: (rowNumber: number) => void;
}) {
  if (!verdict) {
    return <p className="text-xs text-muted-foreground">Not checked yet — re-check to validate this row.</p>;
  }
  const rowErrors = verdict.errors.filter((e) => e.field === "row");
  const dup = verdict.duplicateOf;
  const likely = isLikelyDuplicate(dup);
  const cellErrors = verdict.errors.length - rowErrors.length;

  return (
    <ul className="space-y-1 text-xs">
      {dirty ? (
        <li className="flex gap-1 text-sky-800 dark:text-sky-300">
          <RefreshCw className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Changed — re-check to validate</span>
        </li>
      ) : null}
      {cellErrors > 0 ? (
        <li className="flex gap-1 text-rose-700 dark:text-rose-400">
          <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{plural(cellErrors, "cell needs fixing", "cells need fixing")} — not imported until fixed</span>
        </li>
      ) : null}
      {rowErrors.map((e, i) => (
        <li key={`e-${i}`} className="flex gap-1 text-rose-700 dark:text-rose-400">
          <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{e.message}</span>
        </li>
      ))}
      {dup ? (
        <li className="space-y-1 text-amber-800 dark:text-amber-300">
          <span className="flex gap-1">
            <Copy className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              {dup.reason}
              {dup.trackingCode && !dup.reason.includes(dup.trackingCode) ? (
                <span className="ml-1 font-mono">({dup.trackingCode})</span>
              ) : null}
              {likely ? "" : " — always skipped: an order ref is imported only once."}
            </span>
          </span>
          {likely && cls !== "excluded" ? (
            <label className="flex min-h-8 cursor-pointer items-center gap-2 pl-4.5 font-medium text-foreground">
              <Checkbox checked={cls === "override"} onCheckedChange={() => onToggleAllowDup(rowNumber)} aria-label={`Import row ${rowNumber} anyway`} />
              Import anyway
            </label>
          ) : null}
        </li>
      ) : null}
      {verdict.warnings.map((w, i) => (
        <li key={`w-${i}`} className="flex gap-1 text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{w}</span>
        </li>
      ))}
      {verdict.data.pickupFromDefault && verdict.status !== "invalid" ? (
        <li className="text-muted-foreground">Pickup: default address</li>
      ) : null}
      {!dirty && !verdict.errors.length && !dup && !verdict.warnings.length && !verdict.data.pickupFromDefault ? (
        <li className="text-muted-foreground">—</li>
      ) : null}
    </ul>
  );
}
