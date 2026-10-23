"use client";

import type { ReactNode } from "react";
import { format } from "date-fns";
import { AlertTriangle, ChevronRight, LayoutGrid, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ENTER_MOTION, PRESS } from "@/components/fleetflow/driver/job-utils";

/** Same emerald surface as the driver portal and dispatch heroes. */
function HeroSurface({ children }: { children: ReactNode }) {
  return (
    <section
      aria-labelledby="dashboard-title"
      className={cn(
        "relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 p-4 text-white sm:p-6",
        "shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_32px_-16px_rgb(4_120_87/0.6)] dark:from-emerald-950 dark:via-emerald-900 dark:to-teal-900 dark:shadow-none dark:ring-1 dark:ring-white/10",
        ENTER_MOTION,
      )}
    >
      {/* light-mode scrim: lifts white small text to ≥4.5:1 on the emerald-600 / teal-600 stops */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-black/15 dark:hidden" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_100%_0%,rgb(255_255_255/0.18),transparent_55%)]"
        aria-hidden="true"
      />
      {children}
    </section>
  );
}

export interface HeroTileProps {
  label: string;
  value: number;
  sub?: string;
  /** Rose ring + solid badge — only for the overdue tile when it is non-zero. */
  alert?: boolean;
  onClick: () => void;
  actionLabel: string;
}

function HeroTile({ label, value, sub, alert, onClick, actionLabel }: HeroTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}${sub ? `, ${sub}` : ""}. ${actionLabel}`}
      className={cn(
        "group flex min-h-[5.5rem] min-w-0 flex-col justify-between gap-1 rounded-2xl bg-emerald-950/25 px-3 py-3 text-left ring-1 ring-inset sm:px-4 dark:bg-white/5",
        "transition-[background-color,transform,box-shadow] duration-200 outline-none hover:bg-emerald-950/35 focus-visible:ring-[3px] focus-visible:ring-white/70 motion-safe:active:scale-[0.98] dark:hover:bg-white/10",
        alert ? "ring-2 ring-rose-300/80" : "ring-white/15",
      )}
    >
      <span className="flex items-center gap-2 text-2xl leading-9 font-semibold tabular-nums sm:text-3xl">
        {value}
        {alert ? (
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-rose-500 shadow-sm" aria-hidden="true">
            <AlertTriangle className="size-3.5 text-white" />
          </span>
        ) : null}
        <ChevronRight
          className="ml-auto size-4 shrink-0 text-white/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-white"
          aria-hidden="true"
        />
      </span>
      <span className="text-sm leading-tight text-white/90">
        {label}
        {sub ? <span className="block text-xs text-white/80">{sub}</span> : null}
      </span>
    </button>
  );
}

export function DashboardHero({
  greeting,
  name,
  today,
  live,
  refreshing,
  onRefresh,
  onNewDelivery,
  onOpenDispatch,
  tiles,
}: {
  greeting: string;
  name: string;
  today: Date;
  live: string;
  refreshing: boolean;
  onRefresh: () => void;
  onNewDelivery: () => void;
  onOpenDispatch: () => void;
  tiles: HeroTileProps[];
}) {
  return (
    <HeroSurface>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/90">{format(today, "EEEE, d MMMM")}</p>
          <h2 id="dashboard-title" className="mt-0.5 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
            {greeting}
            {name ? `, ${name}` : ""}
          </h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-white/90" aria-live="polite">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full rounded-full bg-emerald-200 opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-200" />
            </span>
            <span>
              Live · <span className="tabular-nums">{live}</span>
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="-my-2 flex size-11 items-center justify-center rounded-full text-white/90 transition-colors outline-none hover:bg-white/15 hover:text-white focus-visible:ring-[3px] focus-visible:ring-white/60 disabled:opacity-70 sm:size-8"
              aria-label="Refresh the dashboard"
            >
              <RefreshCw className={cn("size-4", refreshing && "motion-safe:animate-spin")} aria-hidden="true" />
            </button>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Button
            onClick={onNewDelivery}
            className={cn(
              "h-11 rounded-xl bg-white px-4 font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 focus-visible:ring-white/60 sm:h-10 dark:bg-white dark:text-emerald-900 dark:hover:bg-emerald-50",
              PRESS,
            )}
          >
            <Plus aria-hidden="true" /> New delivery
          </Button>
          <Button
            variant="ghost"
            onClick={onOpenDispatch}
            className={cn(
              "h-11 rounded-xl bg-white/10 px-4 font-semibold text-white ring-1 ring-inset ring-white/25 hover:bg-white/20 hover:text-white focus-visible:ring-white/60 sm:h-10",
              PRESS,
            )}
          >
            <LayoutGrid aria-hidden="true" />
            <span className="sm:hidden">Dispatch</span>
            <span className="hidden sm:inline">Open dispatch board</span>
          </Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <HeroTile key={t.label} {...t} />
        ))}
      </div>
    </HeroSurface>
  );
}
