"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, PRIORITY_LABELS, type DeliveryStatus, type Priority } from "@/lib/constants";
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// ── Status pill (tinted background + coloured dot) ───────────

const PILL_STYLES: Record<string, { pill: string; dot: string }> = {
  CREATED: { pill: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300", dot: "bg-zinc-400" },
  ASSIGNED: { pill: "bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300", dot: "bg-teal-500" },
  PICKED_UP: { pill: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300", dot: "bg-amber-500" },
  IN_TRANSIT: { pill: "bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300", dot: "bg-sky-500" },
  DELIVERED: { pill: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300", dot: "bg-emerald-500" },
  FAILED: { pill: "bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300", dot: "bg-rose-500" },
  CANCELLED: { pill: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-400", dot: "bg-zinc-400" },
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const style = PILL_STYLES[status] ?? PILL_STYLES.CREATED;
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ring-1 ring-inset ring-current/10",
        style.pill,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden="true" />
      {STATUS_LABELS[status as DeliveryStatus] ?? status}
    </span>
  );
}

/** Only URGENT / HIGH get a marker — Normal and Low stay quiet. */
export function PriorityMarker({ priority, className }: { priority: string; className?: string }) {
  if (priority !== "URGENT" && priority !== "HIGH") return null;
  const urgent = priority === "URGENT";
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold",
        urgent
          ? "bg-rose-600 text-white dark:bg-rose-500/20 dark:text-rose-200"
          : "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", urgent ? "bg-white motion-safe:animate-pulse dark:bg-rose-300" : "bg-amber-500")}
        aria-hidden="true"
      />
      {PRIORITY_LABELS[priority as Priority] ?? priority}
    </span>
  );
}

// ── Bottom-sheet dialog (full width on phones, centred card ≥sm) ─

const SHEET_CONTENT = cn(
  "flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[88vh] sm:rounded-2xl dark:border-white/10",
  // phone: anchored to the bottom like a sheet
  "max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0",
  "max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0",
  "max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:slide-in-from-bottom-10 max-sm:data-[state=closed]:slide-out-to-bottom-10",
);

export function SheetDialogContent({
  className,
  children,
  closeDisabled,
}: {
  className?: string;
  children: ReactNode;
  /** Hide the close affordance while a submission is in flight. */
  closeDisabled?: boolean;
}) {
  return (
    <DialogContent className={cn(SHEET_CONTENT, className)} showCloseButton={false} aria-describedby={undefined}>
      {children}
      <DialogClose
        disabled={closeDisabled}
        className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      >
        <X className="size-5" aria-hidden="true" />
        <span className="sr-only">Close</span>
      </DialogClose>
    </DialogContent>
  );
}

export function SheetHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="shrink-0 px-5 pt-5 pb-4 pr-16 sm:px-6 sm:pt-6">
      <DialogTitle className="text-lg font-semibold leading-tight tracking-tight">{title}</DialogTitle>
      {description ? <DialogDescription className="mt-1.5 text-sm leading-relaxed">{description}</DialogDescription> : null}
    </div>
  );
}

export function SheetBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6", className)}>{children}</div>;
}

/** Sticky footer — primary action on the right (≥sm) or on top / full width (phone). */
export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border/70 bg-background px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6 sm:pb-4 dark:border-white/10">
      {children}
    </div>
  );
}
