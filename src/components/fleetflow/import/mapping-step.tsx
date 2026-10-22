"use client";

import { useId, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, ClipboardPaste, FileSpreadsheet, Loader2 } from "lucide-react";

import { goToSettings } from "@/store/app-store";
import { COLUMN_LABELS, IMPORT_COLUMNS, REQUIRED_COLUMNS, type ImportColumn } from "@/lib/delivery-import";
import { MAX_IMPORT_ROWS } from "@/lib/import-contract";
import { truncate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  columnLetter,
  dataRecords,
  defaultHasHeader,
  delimiterLabel,
  headerSignature,
  loadRememberedMapping,
  mappingConflicts,
  missingRequired,
  suggestTargets,
  type ColumnTarget,
  type ParsedSource,
} from "./parse";
import { ErrorBox, StepTitle, Stepper, fmt, plural, type OrgResponse, type SourceInput } from "./shared";

export interface MappingState {
  hasHeader: boolean;
  mapping: ColumnTarget[];
}

const SKIP = "__skip";

/** First mapping for a source: remembered for this header layout, else suggested. */
export function initialMapping(parsed: ParsedSource): MappingState {
  const hasHeader = defaultHasHeader(parsed.records);
  return { hasHeader, mapping: mappingFor(parsed, hasHeader) };
}

function mappingFor(parsed: ParsedSource, hasHeader: boolean): ColumnTarget[] {
  const sig = headerSignature(parsed.records, hasHeader, parsed.columnCount);
  return loadRememberedMapping(sig, parsed.columnCount) ?? suggestTargets(parsed.records, hasHeader, parsed.columnCount);
}

export function MappingStep({
  source,
  parsed,
  initial,
  org,
  checking,
  error,
  onBack,
  onCancel,
  onNext,
}: {
  source: SourceInput;
  parsed: ParsedSource;
  initial: MappingState;
  org: OrgResponse["organization"] | undefined;
  checking: boolean;
  error: string | null;
  onBack: () => void;
  onCancel: () => void;
  onNext: (state: MappingState) => void;
}) {
  const id = useId();
  const [hasHeader, setHasHeader] = useState(initial.hasHeader);
  const [mapping, setMapping] = useState<ColumnTarget[]>(initial.mapping);

  const { records, columnCount } = parsed;
  const data = useMemo(() => dataRecords(records, hasHeader), [records, hasHeader]);
  const samples = useMemo(() => {
    const out: string[][] = Array.from({ length: columnCount }, () => []);
    for (const { record } of data) {
      let full = true;
      for (let c = 0; c < columnCount; c++) {
        const v = (record[c] ?? "").trim();
        if (v && out[c].length < 3) out[c].push(v);
        if (out[c].length < 3) full = false;
      }
      if (full) break;
    }
    return out;
  }, [data, columnCount]);

  // Pickup is required unless the org has a default (unknown while loading → don't block; the server decides).
  const pickupRequired = !!org && !org.defaultPickupAddress;
  const conflicts = mappingConflicts(mapping);
  const missing = missingRequired(mapping, pickupRequired);
  const tooMany = data.length > MAX_IMPORT_ROWS;
  const empty = data.length === 0;
  const canContinue = !checking && !conflicts.size && !missing.length && !tooMany && !empty;

  const sourceFor = (col: ImportColumn) => mapping.findIndex((t) => t === col);

  function toggleHeader(next: boolean) {
    setHasHeader(next);
    setMapping(mappingFor(parsed, next));
  }

  function setTarget(index: number, value: string) {
    setMapping((m) => m.map((t, i) => (i === index ? (value === SKIP ? null : (value as ImportColumn)) : t)));
  }

  function columnName(i: number) {
    const h = hasHeader ? (records[0]?.[i] ?? "").trim() : "";
    return h || `Column ${columnLetter(i)}`;
  }

  const requiredList: { col: ImportColumn; note?: string }[] = [
    ...REQUIRED_COLUMNS.map((col) => ({ col })),
    {
      col: "pickup_address" as const,
      note: !org
        ? undefined
        : org.defaultPickupAddress
          ? `optional — blank cells use ${truncate(org.defaultPickupAddress, 40)}`
          : "required — no default pickup address is set",
    },
  ];

  return (
    <>
      <DialogHeader className="gap-3">
        <Stepper current={1} />
        <StepTitle>Match your columns</StepTitle>
        <DialogDescription className="break-all">
          {source.kind === "PASTE" ? (
            <ClipboardPaste className="mr-1 inline size-4 align-text-bottom" aria-hidden />
          ) : (
            <FileSpreadsheet className="mr-1 inline size-4 align-text-bottom" aria-hidden />
          )}
          {source.fileName} · {plural(data.length, "row", "rows")} · {plural(columnCount, "column", "columns")} ·{" "}
          {delimiterLabel(parsed.delimiter)}
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-header`} checked={hasHeader} onCheckedChange={(v) => toggleHeader(v === true)} disabled={checking} />
            <Label htmlFor={`${id}-header`} className="font-normal">
              First row contains headers
            </Label>
          </div>
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Required fields">
            {requiredList.map(({ col, note }) => {
              const mapped = sourceFor(col) >= 0;
              const required = col !== "pickup_address" || pickupRequired;
              return (
                <li
                  key={col}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5",
                    mapped
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : required
                        ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                        : "text-muted-foreground"
                  )}
                  title={note}
                >
                  {mapped ? <CheckCircle2 className="size-3" aria-hidden /> : <Circle className="size-3" aria-hidden />}
                  {COLUMN_LABELS[col]}
                  {required ? <span aria-hidden> *</span> : null}
                  <span className="sr-only">
                    {mapped ? " — matched" : required ? " — required, not matched" : " — optional"}
                    {note ? ` (${note})` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {org && !org.defaultPickupAddress && sourceFor("pickup_address") < 0 ? (
          <p className="text-xs text-muted-foreground">
            Pickup address is required because no default pickup address is set.{" "}
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => goToSettings("company")}>
              Set one in Settings
            </button>{" "}
            to leave it out.
          </p>
        ) : org?.defaultPickupAddress ? (
          <p className="text-xs text-muted-foreground">
            Pickup address is optional — rows without one use your default: {truncate(org.defaultPickupAddress, 60)}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-lg border">
          <div className="hidden grid-cols-[minmax(0,12rem)_minmax(0,1fr)_14rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Your column</span>
            <span>Sample values</span>
            <span>Import as</span>
          </div>
          <ul className="divide-y">
            {mapping.map((target, i) => {
              const conflict = !!target && conflicts.has(target);
              const errId = `${id}-err-${i}`;
              const others = target ? mapping.map((t, j) => (t === target && j !== i ? columnName(j) : null)).filter(Boolean) : [];
              return (
                <li key={i} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_14rem] sm:items-center sm:gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={columnName(i)}>
                      {columnName(i)}
                    </p>
                    {hasHeader && (records[0]?.[i] ?? "").trim() ? (
                      <p className="text-xs text-muted-foreground">Column {columnLetter(i)}</p>
                    ) : null}
                  </div>
                  <div className="min-w-0 text-xs text-muted-foreground">
                    {samples[i]?.length ? (
                      <ul className="flex flex-wrap gap-1">
                        {samples[i].map((s, k) => (
                          <li key={k} className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono" title={s}>
                            {truncate(s, 40)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="italic">empty</span>
                    )}
                  </div>
                  <div>
                    <Select value={target ?? SKIP} onValueChange={(v) => setTarget(i, v)} disabled={checking}>
                      <SelectTrigger
                        className={cn("min-h-11 w-full sm:min-h-9", !target && "text-muted-foreground")}
                        aria-label={`Import ${columnName(i)} as`}
                        aria-invalid={conflict || undefined}
                        aria-describedby={conflict ? errId : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>Don&apos;t import</SelectItem>
                        <SelectSeparator />
                        {IMPORT_COLUMNS.map((col) => {
                          const required = REQUIRED_COLUMNS.includes(col) || (col === "pickup_address" && pickupRequired);
                          return (
                            <SelectItem key={col} value={col}>
                              {COLUMN_LABELS[col]}
                              {required ? " *" : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {conflict ? (
                      <p id={errId} className="mt-1 text-xs text-rose-700 dark:text-rose-400">
                        {COLUMN_LABELS[target!]} is also chosen for {others.join(", ")} — pick it for one column only.
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {tooMany ? (
          <ErrorBox>
            This has {fmt(data.length)} rows; up to {fmt(MAX_IMPORT_ROWS)} can be checked at once. Split the rows into smaller parts and
            import them one at a time.
          </ErrorBox>
        ) : empty ? (
          <ErrorBox>There are no data rows{hasHeader ? " below the header" : ""}.</ErrorBox>
        ) : null}
        {missing.length && !tooMany && !empty ? (
          <p className="text-sm text-rose-700 dark:text-rose-400" role="status">
            Choose a column for: {missing.map((c) => COLUMN_LABELS[c]).join(", ")}.
          </p>
        ) : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onBack} disabled={checking}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel} disabled={checking}>
            Cancel
          </Button>
          <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => onNext({ hasHeader, mapping })} disabled={!canContinue}>
            {checking ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            {checking ? `Checking ${fmt(data.length)} rows…` : `Check ${plural(data.length, "row", "rows")}`}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
