"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileUp, PackagePlus, RefreshCw } from "lucide-react";
import { useApiData } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { goToDeliveries, goToDeliveriesAction, goToDelivery, useAppStore } from "@/store/app-store";
import type { DashboardData } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingChecklist } from "@/components/fleetflow/onboarding-checklist";
import { CARD_SURFACE, ENTER_MOTION, PRESS, firstName, greeting } from "@/components/fleetflow/driver/job-utils";
import { liveLabel } from "@/components/fleetflow/dispatch/hero";
import { DashboardHero, type HeroTileProps } from "@/components/fleetflow/dashboard/hero";
import { ActivityPanel, DriversPanel, NeedsAttention, PerformanceCard } from "@/components/fleetflow/dashboard/panels";
import { attentionItems, statusSegments, sumDaily, topDrivers, type AttentionItem } from "@/components/fleetflow/dashboard/model";

const POLL_MS = 60_000;
const MAX_DRIVERS = 6;
const MAX_EVENTS = 8;

// ── States ───────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:gap-5" aria-busy="true" aria-label="Loading the dashboard">
      <div className="rounded-3xl bg-muted p-4 sm:p-6">
        <Skeleton className="h-4 w-32 bg-foreground/10" />
        <Skeleton className="mt-2 h-8 w-64 max-w-full bg-foreground/10" />
        <Skeleton className="mt-2 h-4 w-40 bg-foreground/10" />
        <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[5.5rem] rounded-2xl bg-foreground/10" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-4 sm:gap-5 xl:col-span-2">
          <div className={cn(CARD_SURFACE, "space-y-3 p-4 sm:p-5")}>
            <Skeleton className="h-5 w-36" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
          <div className={cn(CARD_SURFACE, "space-y-3 p-4 sm:p-5")}>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-[180px] w-full sm:h-[220px]" />
          </div>
        </div>
        <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-1 xl:content-start">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={cn(CARD_SURFACE, "space-y-3 p-4 sm:p-5")}>
              <Skeleton className="h-5 w-28" />
              {Array.from({ length: 4 }).map((__, j) => (
                <Skeleton key={j} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className={cn(CARD_SURFACE, "flex flex-col items-center gap-3 px-6 py-12 text-center", ENTER_MOTION)} role="alert">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400" aria-hidden="true">
          <AlertTriangle className="size-7" />
        </span>
        <h2 className="text-lg font-semibold tracking-tight">Couldn&apos;t load the dashboard</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
        <Button onClick={onRetry} className={cn("mt-1 h-11 rounded-xl px-5 sm:h-10", PRESS)}>
          <RefreshCw aria-hidden="true" /> Try again
        </Button>
      </div>
    </div>
  );
}

/** Shown in place of the charts until the organization has its first delivery. */
function FirstDeliveryEmptyState() {
  return (
    <section
      aria-labelledby="first-delivery-heading"
      className={cn(CARD_SURFACE, "relative isolate overflow-hidden px-5 py-8 sm:px-8 sm:py-10", ENTER_MOTION)}
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(90%_70%_at_0%_0%,rgb(16_185_129/0.10),transparent_60%)]"
        aria-hidden="true"
      />
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
        <PackagePlus className="size-6" aria-hidden="true" />
      </span>
      <h2 id="first-delivery-heading" className="mt-4 text-lg font-semibold tracking-tight">
        Send out your first delivery
      </h2>
      <p className="mt-1 max-w-prose text-sm text-pretty text-muted-foreground">
        Your daily numbers, on-time rate and alerts fill in as soon as deliveries start moving. Add one order by hand, or bring in
        today&apos;s orders from a spreadsheet.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => goToDeliveriesAction("create")} className={cn("h-11 rounded-xl px-4 font-semibold sm:h-10", PRESS)}>
          <PackagePlus aria-hidden="true" /> Create a delivery
        </Button>
        <Button variant="outline" onClick={() => goToDeliveriesAction("import")} className={cn("h-11 rounded-xl px-4 sm:h-10", PRESS)}>
          <FileUp aria-hidden="true" /> Import from CSV
        </Button>
      </div>
    </section>
  );
}

// ── Main view ────────────────────────────────────────────────

export function DashboardView() {
  const setView = useAppStore((s) => s.setView);
  const session = useAppStore((s) => s.session);
  // Daily buckets and "today" are keyed by the viewer's local date.
  const tz = new Date().getTimezoneOffset();
  const { data, loading, error, reload } = useApiData<DashboardData>(`/api/dashboard?tz=${tz}`);

  // ── Live refresh (every minute while the tab is visible) ────
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- stamp each successful load
    if (data) setUpdatedAt(Date.now());
  }, [data]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 15_000);
    const poll = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, POLL_MS);
    const onVisible = () => {
      if (document.hidden) return;
      setNowMs(Date.now());
      void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  function refreshNow() {
    setNowMs(Date.now());
    void reload();
  }

  const items = useMemo(() => (data ? attentionItems(data) : []), [data]);
  const segments = useMemo(() => statusSegments(data?.statusBreakdown ?? []), [data]);
  const window14 = useMemo(() => sumDaily(data?.daily ?? []), [data]);
  const drivers = useMemo(() => topDrivers(data?.driverWorkload ?? [], MAX_DRIVERS), [data]);

  if (!data) {
    if (error && !loading) return <LoadError message={error} onRetry={refreshNow} />;
    return <DashboardSkeleton />;
  }

  const { stats } = data;
  const todayNums = data.today ?? { created: 0, delivered: 0, failed: 0 };
  const live = data.now ?? { waiting: stats.pendingAssignment, onTheRoad: stats.inProgress, overdue: 0, dueToday: 0 };
  const onlyOverdue = live.overdue === 1 ? data.attention.overdueDeliveries?.[0] : undefined;
  const openDispatch = () => setView("dispatch");

  const tiles: HeroTileProps[] = [
    {
      label: "Delivered today",
      value: todayNums.delivered,
      sub: todayNums.failed > 0 ? `${todayNums.failed} failed ${todayNums.failed === 1 ? "attempt" : "attempts"}` : `${todayNums.created} created today`,
      onClick: () => goToDeliveries("DELIVERED"),
      actionLabel: "Open delivered deliveries",
    },
    {
      label: "On the road now",
      value: live.onTheRoad,
      onClick: openDispatch,
      actionLabel: "Open the dispatch board",
    },
    {
      label: "Waiting for a driver",
      value: live.waiting,
      onClick: openDispatch,
      actionLabel: "Assign on the dispatch board",
    },
    {
      label: "Overdue",
      value: live.overdue,
      sub: live.dueToday > 0 ? `${live.dueToday} more due today` : undefined,
      alert: live.overdue > 0,
      onClick: onlyOverdue ? () => goToDelivery(onlyOverdue.id) : openDispatch,
      actionLabel: onlyOverdue ? `Open delivery ${onlyOverdue.trackingCode}` : "Open the dispatch board",
    },
  ];

  const actionFor = (item: AttentionItem): { label: string; run: () => void } => {
    switch (item.kind) {
      case "overdue":
        return { label: "View", run: item.singleDeliveryId ? () => goToDelivery(item.singleDeliveryId!) : openDispatch };
      case "failed":
        return { label: "Re-dispatch", run: openDispatch };
      case "urgent":
        return { label: "Assign", run: openDispatch };
      case "vehicles":
        return { label: "View", run: () => setView("vehicles") };
    }
  };

  const noDeliveries = stats.total === 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:gap-5" aria-busy={loading}>
      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:flex-row sm:items-center dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <span className="flex min-w-0 flex-1 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Couldn&apos;t refresh — showing the last numbers we loaded. {error}</span>
          </span>
          <Button size="sm" variant="outline" onClick={refreshNow} className={cn("min-h-11 rounded-xl bg-white sm:min-h-8 dark:bg-transparent", PRESS)}>
            <RefreshCw aria-hidden="true" /> Retry
          </Button>
        </div>
      ) : null}

      <DashboardHero
        greeting={greeting(new Date(nowMs))}
        name={firstName(session?.name)}
        today={new Date(nowMs)}
        live={liveLabel(updatedAt, nowMs)}
        refreshing={loading}
        onRefresh={refreshNow}
        onNewDelivery={() => goToDeliveriesAction("create")}
        onOpenDispatch={openDispatch}
        tiles={tiles}
      />

      <OnboardingChecklist />

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5 xl:col-span-2">
          {noDeliveries ? (
            <FirstDeliveryEmptyState />
          ) : (
            <>
              <NeedsAttention items={items} actionFor={actionFor} />
              <PerformanceCard
                daily={data.daily}
                totals={window14}
                stats={stats}
                segments={segments}
                onOpenReports={() => setView("reports")}
              />
            </>
          )}
        </div>
        <div className="grid min-w-0 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-1 xl:content-start">
          <DriversPanel
            drivers={drivers}
            total={data.driverWorkload.length}
            onOpenDispatch={openDispatch}
            onOpenDrivers={() => setView("drivers")}
          />
          <ActivityPanel
            events={data.recentEvents.slice(0, MAX_EVENTS)}
            onOpenDelivery={goToDelivery}
            onOpenAudit={() => setView("audit")}
          />
        </div>
      </div>
    </div>
  );
}

export default DashboardView;
