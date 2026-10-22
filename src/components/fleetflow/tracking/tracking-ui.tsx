"use client";

import type { ReactNode } from "react";
import { Package, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { monogram } from "./tracking-model";

// ─────────────────────────────────────────────────────────────
// Shared surfaces + page chrome for the public tracking page.
// ─────────────────────────────────────────────────────────────

export const SURFACE =
  "rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.15)] dark:border-white/10 dark:shadow-none";

/** Shared page width: single column on phones, two columns from lg. */
export const PAGE_WIDTH = "mx-auto w-full max-w-xl px-4 sm:px-6 lg:max-w-5xl";

/** Motion-safe enter animation (tw-animate-css). */
export const ENTER = "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200";

export function Surface({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn(SURFACE, className)} {...props}>
      {children}
    </section>
  );
}

/** Sender-branded header. With no sender yet (loading / link problems) it stays neutral. */
export function TrackingHeader({ senderName, loading }: { senderName: string | null; loading?: boolean }) {
  return (
    <header className="border-b border-border/60 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70 dark:border-white/10">
      <div className={cn(PAGE_WIDTH, "flex h-16 items-center gap-3")}>
        {loading ? (
          <>
            <Skeleton className="size-10 rounded-xl" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-36" />
            </div>
          </>
        ) : senderName ? (
          <>
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-700 to-teal-700 text-sm font-semibold tracking-wide text-white shadow-sm ring-1 ring-inset ring-white/15"
              aria-hidden="true"
            >
              {monogram(senderName)}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-xs text-muted-foreground">Delivery from</p>
              <p className="truncate font-semibold tracking-tight">{senderName}</p>
            </div>
          </>
        ) : (
          <>
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
              aria-hidden="true"
            >
              <Package className="size-5" />
            </div>
            <p className="font-semibold tracking-tight">Delivery tracking</p>
          </>
        )}
      </div>
    </header>
  );
}

export function TrackingFooter() {
  return (
    <footer className="mt-auto">
      <p className={cn(PAGE_WIDTH, "flex items-center justify-center gap-1.5 py-6 text-xs text-muted-foreground")}>
        <Truck className="size-3.5" aria-hidden="true" />
        Tracking powered by FleetFlow
      </p>
    </footer>
  );
}

/** Full-page message for link problems and errors. */
export function StatusCard({
  icon,
  tone,
  title,
  children,
  steps,
  action,
}: {
  icon: ReactNode;
  tone: "amber" | "slate";
  title: string;
  children: ReactNode;
  steps?: string[];
  action?: ReactNode;
}) {
  return (
    <Surface className={cn("mx-auto max-w-xl overflow-hidden", ENTER)}>
      <div className="px-6 pt-8 pb-6 text-center sm:px-10 sm:pt-10">
        <div
          className={cn(
            "mx-auto flex size-14 items-center justify-center rounded-2xl ring-1 ring-inset",
            tone === "amber"
              ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/60"
              : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-white/10",
          )}
        >
          {icon}
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground">{children}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
      {steps && steps.length > 0 ? (
        <div className="border-t border-border/70 bg-muted/40 px-6 py-5 sm:px-10 dark:border-white/10">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What you can do</h2>
          <ol className="mt-3 flex flex-col gap-2.5">
            {steps.map((s, i) => (
              <li key={s} className="flex items-start gap-3 text-sm">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold tabular-nums ring-1 ring-border"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="leading-5">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Surface>
  );
}

/** Skeleton that mirrors the ready layout so nothing jumps when data lands. */
export function TrackingSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6">
      <span className="sr-only">Checking your delivery…</span>
      <div className="flex flex-col gap-4">
        <div className="rounded-3xl bg-muted p-6 sm:p-8">
          <Skeleton className="h-5 w-28 rounded-full bg-background/60" />
          <Skeleton className="mt-6 h-9 w-48 bg-background/60" />
          <Skeleton className="mt-3 h-4 w-full max-w-sm bg-background/60" />
          <Skeleton className="mt-6 h-10 w-56 rounded-xl bg-background/60" />
        </div>
        <div className={cn(SURFACE, "p-5 sm:p-6")}>
          <div className="flex flex-col gap-5 sm:flex-row sm:justify-between">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 sm:flex-col">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
        <div className={cn(SURFACE, "flex flex-col gap-3 p-5 sm:p-6")}>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      </div>
      <div className={cn(SURFACE, "mt-4 flex flex-col gap-5 p-5 sm:p-6 lg:mt-0")}>
        <Skeleton className="h-4 w-36" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-3 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
