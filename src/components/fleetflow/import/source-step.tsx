"use client";

import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, ClipboardCopy, ClipboardPaste, Download, FileSpreadsheet, Info, Loader2, Upload } from "lucide-react";

import { goToSettings } from "@/store/app-store";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { IMPORT_COLUMNS, LIKELY_DUPLICATE_DAYS } from "@/lib/delivery-import";
import { MAX_IMPORT_ROWS } from "@/lib/import-contract";
import { truncate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { dataRecords, delimiterLabel, parseSourceText, type ParsedSource } from "./parse";
import {
  ErrorBox,
  GUIDE,
  PASTED_FILE_NAME,
  StepTitle,
  Stepper,
  TEMPLATE_URL,
  WarnBox,
  fmt,
  plural,
  readCsvFile,
  type OrgResponse,
  type SourceInput,
} from "./shared";

type SourceTab = "file" | "paste";

export function SourceStep({
  initial,
  org,
  onNext,
  onCancel,
}: {
  initial: SourceInput | null;
  org: OrgResponse["organization"] | undefined;
  onNext: (source: SourceInput, parsed: ParsedSource) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<SourceTab>(initial?.kind === "PASTE" ? "paste" : "file");
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  async function handleFile(f: File) {
    setFileError(null);
    if (!/\.csv$/i.test(f.name)) {
      setFileError("Only .csv files can be uploaded. In Excel, use File → Save As → “CSV UTF-8 (Comma delimited)” — or copy the rows and use “Paste from spreadsheet”.");
      return;
    }
    if (f.size > CSV_MAX_BYTES) {
      setFileError(`This file is ${(f.size / 1024 / 1024).toFixed(1)} MB; the limit is 1 MB. Split it into smaller files, or paste the rows instead.`);
      return;
    }
    if (f.size === 0) {
      setFileError("This file is empty.");
      return;
    }
    setReading(true);
    try {
      const { text, legacyEncoding } = await readCsvFile(f);
      const res = parseSourceText(text);
      if (!res.ok) {
        setFileError(`The file couldn't be read: ${res.message}`);
        return;
      }
      if (legacyEncoding) {
        toast.warning("This file isn't saved as UTF-8 — Bangla text may look wrong. Save it as “CSV UTF-8” to be safe.");
      }
      onNext({ kind: "CSV", fileName: f.name, text }, res.parsed);
    } catch {
      setFileError("The file couldn't be read. Try saving it again as “CSV UTF-8”.");
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <DialogHeader className="gap-3">
        <Stepper current={0} />
        <StepTitle>Import deliveries</StepTitle>
        <DialogDescription>
          Upload a CSV or paste rows from a spreadsheet. You&apos;ll match the columns and see every row checked before anything is saved.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-1">
        <Tabs value={tab} onValueChange={(v) => setTab(v as SourceTab)}>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="file" className="min-h-9 px-3" disabled={reading}>
              <Upload aria-hidden /> Upload CSV
            </TabsTrigger>
            <TabsTrigger value="paste" className="min-h-9 px-3" disabled={reading}>
              <ClipboardPaste aria-hidden /> Paste from spreadsheet
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="mt-3 space-y-3">
            <DropZone reading={reading} onFile={handleFile} />
            {fileError ? <ErrorBox>{fileError}</ErrorBox> : null}
          </TabsContent>
          <TabsContent value="paste" className="mt-3">
            <PastePanel initialText={initial?.kind === "PASTE" ? initial.text : ""} onNext={onNext} />
          </TabsContent>
        </Tabs>

        <TemplateBar />

        {org && !org.defaultPickupAddress ? (
          <WarnBox>
            No default pickup address is set, so every row needs a pickup address.{" "}
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => goToSettings("company")}>
              Set one in Settings
            </button>
          </WarnBox>
        ) : null}

        <FormatGuide org={org} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel} disabled={reading}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Upload ───────────────────────────────────────────────────

function DropZone({ reading, onFile }: { reading: boolean; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick(files: FileList | null) {
    const f = files?.[0];
    if (f && !reading) onFile(f);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!reading) setDragging(true);
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
        reading && "opacity-70"
      )}
    >
      {reading ? (
        <>
          <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
          <p className="text-sm font-medium" aria-live="polite">
            Reading your file…
          </p>
        </>
      ) : (
        <>
          <Upload className="size-10 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium">Drag a .csv file here</p>
            <p className="text-xs text-muted-foreground">Up to {fmt(MAX_IMPORT_ROWS)} rows and 1 MB per file</p>
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
  );
}

// ── Paste ────────────────────────────────────────────────────

function PastePanel({
  initialText,
  onNext,
}: {
  initialText: string;
  onNext: (source: SourceInput, parsed: ParsedSource) => void;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  // Parsing thousands of rows on every keystroke would make typing lag.
  const deferred = useDeferredValue(text);
  const result = useMemo(() => (deferred.trim() ? parseSourceText(deferred) : null), [deferred]);
  const rowCount = result?.ok ? result.parsed.records.length : 0;
  const nonBlank = result?.ok ? dataRecords(result.parsed.records, false).length : 0;
  const upToDate = deferred === text;

  function next() {
    const res = parseSourceText(text);
    if (res.ok) onNext({ kind: "PASTE", fileName: PASTED_FILE_NAME, text }, res.parsed);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-paste`}>Rows to import</Label>
      <Textarea
        id={`${id}-paste`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Copy rows in Excel or Google Sheets (with or without the header row) and paste here"}
        aria-describedby={`${id}-hint`}
        spellCheck={false}
        className="h-48 resize-y font-mono text-xs whitespace-pre [overflow-wrap:normal]"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p id={`${id}-hint`} className="text-xs text-muted-foreground" aria-live="polite">
          {!result
            ? "Copy rows in Excel or Google Sheets (with or without the header row) and paste here."
            : result.ok
              ? `Detected ${plural(nonBlank, "row", "rows")} × ${plural(result.parsed.columnCount, "column", "columns")} · ${delimiterLabel(result.parsed.delimiter)}${rowCount > nonBlank ? " (blank lines ignored)" : ""}`
              : null}
        </p>
        <Button type="button" className="min-h-11 shrink-0 sm:min-h-9" onClick={next} disabled={!result?.ok || !upToDate}>
          Continue <ArrowRight />
        </Button>
      </div>
      {result && !result.ok ? <ErrorBox>{result.message}</ErrorBox> : null}
    </div>
  );
}

// ── Template + guide ─────────────────────────────────────────

function TemplateBar() {
  async function copyHeader() {
    try {
      await navigator.clipboard.writeText(IMPORT_COLUMNS.join("\t"));
      toast.success("Header row copied — paste it into the first cell of your sheet");
    } catch {
      toast.error("Couldn't copy to the clipboard — download the template instead");
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">Start from the template — it has the right columns and two example rows.</p>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={copyHeader}>
          <ClipboardCopy /> Copy header row
        </Button>
        <Button asChild variant="secondary" size="sm" className="min-h-11 sm:min-h-8">
          <a href={TEMPLATE_URL} download>
            <Download /> Download template
          </a>
        </Button>
      </div>
    </div>
  );
}

function FormatGuide({ org }: { org: OrgResponse["organization"] | undefined }) {
  return (
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
                  : g.column === "pickup_address" && org
                    ? "Required — no default pickup address is set"
                    : g.accepts}
              </dd>
            </div>
          ))}
        </dl>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            The header row is optional. Column names are matched ignoring case and spaces (e.g. “Phone”, “Order No”), and you can
            change the matching in the next step.
          </li>
          <li>
            Dates are read day-first in your organization&apos;s timezone ({org?.timezone ?? "Asia/Dhaka"}); 10/25/2026 (month
            first) is rejected, not guessed.
          </li>
          <li>
            Duplicates are skipped: an order_ref used twice or already in FleetFlow, and rows with the same phone, address and
            expected date as another row or a delivery from the last {LIKELY_DUPLICATE_DAYS} days (you can import those anyway).
          </li>
          <li>Rows with errors are never imported — fix them in the review step, or download them and import them again later.</li>
        </ul>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          Up to {fmt(MAX_IMPORT_ROWS)} rows are checked at once; large imports are saved in batches.
        </p>
      </div>
    </details>
  );
}
