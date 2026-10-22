"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Check, Info } from "lucide-react";

import { DATE_ONLY_LABEL, type DuplicateInfo, type ImportRowStatus } from "@/lib/delivery-import";
import type { ImportSource } from "@/lib/import-contract";
import { Badge } from "@/components/ui/badge";
import { DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Small pieces shared by the import dialog's steps.
// ─────────────────────────────────────────────────────────────

export const TEMPLATE_URL = "/api/deliveries/import/template";

/** Preview table page size — never render thousands of DOM rows. */
export const PAGE_SIZE = 50;

export interface OrgResponse {
  organization: { defaultPickupAddress: string | null; timezone: string };
}

/** What the user gave us in step 1. */
export interface SourceInput {
  kind: ImportSource;
  /** File name, or "Pasted rows". */
  fileName: string;
  text: string;
}

export const PASTED_FILE_NAME = "Pasted rows";

export const fmt = (n: number) => n.toLocaleString("en-US");
export const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

export function isLikelyDuplicate(dup: DuplicateInfo | null | undefined): boolean {
  return !!dup && (dup.kind === "likely_in_file" || dup.kind === "likely_existing");
}

export const GUIDE: { column: string; required?: boolean; accepts: string }[] = [
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

/** Read a file as UTF-8; fall back to Windows-1252 (Excel's plain "CSV"). */
export async function readCsvFile(file: File): Promise<{ text: string; legacyEncoding: boolean }> {
  const buf = await file.arrayBuffer();
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), legacyEncoding: false };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buf), legacyEncoding: true };
  }
}

export function baseName(fileName: string): string {
  return fileName === PASTED_FILE_NAME ? "pasted-rows" : fileName.replace(/\.csv$/i, "");
}

// ── Status pill ──────────────────────────────────────────────

export type PillStatus = ImportRowStatus | "excluded" | "changed" | "override";

const STATUS_BADGE: Record<PillStatus, { label: string; className: string }> = {
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
  override: {
    label: "Import anyway",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  },
  changed: {
    label: "Re-check",
    className: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
  },
  excluded: { label: "Excluded", className: "bg-muted text-muted-foreground" },
};

export function StatusPill({ status }: { status: PillStatus }) {
  const s = STATUS_BADGE[status];
  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", s.className)}>
      {s.label}
    </Badge>
  );
}

// ── Notices ──────────────────────────────────────────────────

export function ErrorBox({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function WarnBox({ children, icon: Icon = Info, role }: { children: React.ReactNode; icon?: typeof Info; role?: "alert" | "status" }) {
  return (
    <div
      role={role}
      className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ── Step heading + progress ──────────────────────────────────

/** Dialog title that takes focus when its step mounts (screen readers hear the new step). */
export function StepTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Let Radix finish its own initial focus first.
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <DialogTitle ref={ref} tabIndex={-1} className={cn("outline-none", className)}>
      {children}
    </DialogTitle>
  );
}

const STEPS = ["Source", "Columns", "Review", "Import"] as const;
export type StepIndex = 0 | 1 | 2 | 3;

export function Stepper({ current }: { current: StepIndex }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Import steps">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-primary/40 bg-primary/10 text-primary",
                !active && !done && "text-muted-foreground"
              )}
            >
              {done ? <Check className="size-3" aria-hidden /> : i + 1}
            </span>
            <span className={cn(active ? "font-medium text-foreground" : "text-muted-foreground")}>
              {label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
            {i < STEPS.length - 1 ? <span className="h-px w-4 bg-border" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
