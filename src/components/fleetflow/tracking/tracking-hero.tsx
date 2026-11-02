"use client";

import { AlertCircle, Ban, Banknote, CalendarClock, CircleCheck, RefreshCw, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackingData } from "@/lib/tracking";
import { Button } from "@/components/ui/button";
import { etaLine, heroTone, statusExplanation, statusHeadline, updatedAgo, type HeroTone, type TrackingFormat } from "./tracking-model";
import { ENTER, Surface } from "./tracking-ui";

const TONE_BG: Record<HeroTone, string> = {
  active:
    "bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 dark:from-emerald-950 dark:via-emerald-900 dark:to-teal-900",
  delivered:
    "bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 dark:from-emerald-950 dark:via-emerald-900 dark:to-teal-900",
  // Amber/stone for a missed attempt: clearly "needs attention", never alarming red.
  failed: "bg-gradient-to-br from-amber-800 via-amber-700 to-stone-700 dark:from-amber-950 dark:via-stone-900 dark:to-stone-900",
  cancelled: "bg-gradient-to-br from-slate-700 via-slate-600 to-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900",
};

const TONE_ICON = {
  active: Truck,
  delivered: CircleCheck,
  failed: AlertCircle,
  cancelled: Ban,
} as const;

export function TrackingHero({ data, now, f }: { data: TrackingData; now: number; f: TrackingFormat }) {
  const tone = heroTone(data.status);
  const Icon = TONE_ICON[tone];
  const eta = etaLine(data, now, f);
  const emerald = tone === "active" || tone === "delivered";
  // Branded: the company's colour (already darkened for ≥4.5:1 white text) replaces emerald.
  // Failed / cancelled keep their own meaning colours.
  const branded = emerald && !!data.branding?.color;

  return (
    <section
      aria-labelledby="tracking-status"
      className={cn(
        "relative isolate overflow-hidden rounded-3xl p-6 text-white shadow-[0_1px_2px_rgb(0_0_0/0.06),0_16px_40px_-20px_rgb(4_120_87/0.55)] ring-1 ring-black/5 ring-inset sm:p-8 dark:shadow-none dark:ring-white/10",
        branded ? "bg-[var(--brand-solid)] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_16px_40px_-20px_rgb(0_0_0/0.35)]" : TONE_BG[tone],
        ENTER,
      )}
    >
      {/* Light-mode scrim keeps small white text ≥4.5:1 on the emerald-600/teal-600 stops. */}
      {emerald && !branded ? <div className="pointer-events-none absolute inset-0 -z-10 bg-black/15 dark:bg-transparent" aria-hidden="true" /> : null}
      {branded ? <div className="pointer-events-none absolute inset-0 -z-10 hidden bg-black/25 dark:block" aria-hidden="true" /> : null}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_100%_0%,rgb(255_255_255/0.20),transparent_55%)]"
        aria-hidden="true"
      />
      <Icon className="pointer-events-none absolute -right-8 -bottom-10 -z-10 size-48 text-white/[0.07] sm:size-56" strokeWidth={1.25} aria-hidden="true" />

      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex min-w-0 items-center gap-2 rounded-full bg-black/20 py-1 pr-3 pl-2.5 ring-1 ring-white/15 ring-inset">
          <span className="text-[11px] font-medium tracking-wider uppercase">{f.t.trackingBadge}</span>
          <span className="truncate font-mono text-xs tracking-wider">{data.trackingCode}</span>
        </p>
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25 ring-inset"
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
      </div>

      <h1 id="tracking-status" className="mt-6 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {statusHeadline(data.status, f)}
      </h1>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-pretty text-white" role={tone === "failed" || tone === "cancelled" ? "status" : undefined}>
        {statusExplanation(data, f)}
      </p>

      {eta ? (
        <p className="mt-6 inline-flex items-center gap-2.5 rounded-xl bg-black/20 px-3.5 py-2.5 text-sm font-medium tabular-nums ring-1 ring-white/15 ring-inset" suppressHydrationWarning>
          {tone === "delivered" ? (
            <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
          )}
          {eta}
        </p>
      ) : null}
    </section>
  );
}

/** "Updated 2 min ago · Refresh" row shown while the delivery can still change. */
export function LiveStatus({
  updatedAt,
  now,
  refreshing,
  refreshFailed,
  onRefresh,
  f,
}: {
  updatedAt: number;
  now: number;
  refreshing: boolean;
  refreshFailed: boolean;
  onRefresh: () => void;
  f: TrackingFormat;
}) {
  return (
    <div className="-my-1 flex items-center justify-between gap-3 pl-1">
      <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
        <span className="relative flex size-2 shrink-0" aria-hidden="true">
          {refreshFailed ? (
            <span className="size-2 rounded-full bg-amber-500" />
          ) : (
            <>
              <span className="absolute inset-0 rounded-full bg-emerald-500/60 motion-safe:animate-pulse" />
              <span className="relative size-2 rounded-full bg-emerald-500" />
            </>
          )}
        </span>
        <span className="truncate" role={refreshFailed ? "status" : undefined}>
          {refreshFailed ? f.t.refreshFailed : f.t.live(updatedAgo(updatedAt, now, f))}
        </span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={f.t.refreshAria}
      >
        <RefreshCw className={cn("size-4", refreshing && "motion-safe:animate-spin")} aria-hidden="true" />
        <span className="hidden sm:inline">{refreshing ? f.t.refreshing : f.t.refresh}</span>
      </Button>
    </div>
  );
}

/** Cash-on-delivery amount still to pay — shown prominently while the parcel is on its way. */
export function CodDue({ amount, f }: { amount: number; f: TrackingFormat }) {
  return (
    <Surface aria-labelledby="tracking-cod" className={cn("flex items-center gap-4 p-5 sm:p-6", ENTER)}>
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200 ring-inset dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/60"
        aria-hidden="true"
      >
        <Banknote className="size-5" />
      </span>
      <div className="min-w-0">
        <h2 id="tracking-cod" className="text-sm font-semibold">
          {f.t.codDueTitle}
        </h2>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">{f.money(amount)}</p>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{f.t.codDueHint}</p>
      </div>
    </Surface>
  );
}
