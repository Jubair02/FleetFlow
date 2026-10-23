"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { goToDeliveriesAction } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { ENTER_MOTION, PRESS } from "@/components/fleetflow/driver/job-utils";

/** Same emerald surface as the driver portal hero. */
function HeroSurface({ children }: { children: ReactNode }) {
  return (
    <section
      aria-labelledby="dispatch-title"
      className={cn(
        "relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 p-5 text-white sm:p-6",
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

function KpiTile({ label, value, sub, alert }: { label: string; value: ReactNode; sub?: string; alert?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-2xl bg-emerald-950/25 px-3 py-3 ring-1 ring-inset sm:px-4 dark:bg-white/5",
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
        {sub ? <span className="text-sm font-medium text-white/80">{sub}</span> : null}
      </span>
      <span className="text-sm leading-tight text-white/90">{label}</span>
    </div>
  );
}

export function liveLabel(updatedAt: number | null, nowMs: number): string {
  if (!updatedAt) return "loading…";
  const s = Math.max(0, Math.round((nowMs - updatedAt) / 1000));
  if (s < 45) return "updated just now";
  const m = Math.round(s / 60);
  if (m < 60) return `updated ${m} min ago`;
  return `updated ${Math.round(m / 60)} h ago`;
}

export function DispatchHero({
  waiting,
  failed,
  onRoad,
  driversFree,
  driversActive,
  live,
  refreshing,
  onRefresh,
}: {
  waiting: number;
  failed: number;
  onRoad: number;
  driversFree: number;
  driversActive: number;
  live: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <HeroSurface>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="dispatch-title" className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
            Today&apos;s dispatch
          </h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-white/90">
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
              aria-label="Refresh the dispatch board"
            >
              <RefreshCw className={cn("size-4", refreshing && "motion-safe:animate-spin")} aria-hidden="true" />
            </button>
          </p>
        </div>
        <Button
          onClick={() => goToDeliveriesAction("create")}
          className={cn(
            "h-11 shrink-0 rounded-xl bg-white px-4 font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 focus-visible:ring-white/60 sm:h-10 dark:bg-white dark:text-emerald-900 dark:hover:bg-emerald-50",
            PRESS,
          )}
        >
          <Plus aria-hidden="true" /> New delivery
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <KpiTile label="Waiting for a driver" value={waiting} />
        <KpiTile label="To re-dispatch" value={failed} alert={failed > 0} />
        <KpiTile label="On the road" value={onRoad} />
        <KpiTile label="Drivers available" value={driversFree} sub={`of ${driversActive} active`} />
      </div>
    </HeroSurface>
  );
}
