"use client";

import { useState } from "react";
import { format, isToday } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { MyJob } from "@/lib/types";
import {
  CaughtUpState,
  ErrorCard,
  HeroStat,
  HeroSurface,
  JobCard,
  JobsSkeleton,
  NextStopCard,
  type JobHandlers,
} from "@/components/fleetflow/driver/job-cards";
import { HistoryPanel } from "@/components/fleetflow/driver/history-panel";
import { JobDetailDialog } from "@/components/fleetflow/driver/job-detail-dialog";
import { PodDialog } from "@/components/fleetflow/driver/pod-dialog";
import { ReportProblemDialog } from "@/components/fleetflow/driver/report-problem-dialog";
import {
  byUrgency,
  firstName,
  greeting,
  isOverdue,
  jobEndedAt,
  jobOutcome,
  now,
  type Transition,
} from "@/components/fleetflow/driver/job-utils";

// ─────────────────────────────────────────────────────────────
// Driver portal view — Jobs (driver-jobs) and History (driver-history).
// Navigation lives in the app shell (bottom nav on phones, sidebar ≥md).
// ─────────────────────────────────────────────────────────────

function JobsHero({
  activeCount,
  overdueCount,
  deliveredToday,
}: {
  activeCount: number;
  overdueCount: number;
  /** null while history is loading; undefined when it could not be loaded (stat omitted). */
  deliveredToday: number | null | undefined;
}) {
  const session = useAppStore((s) => s.session);
  const [today] = useState(now);
  const name = firstName(session?.name);
  return (
    <HeroSurface>
      <p className="text-sm font-medium text-white/90">{format(today, "EEEE, d MMMM")}</p>
      <h2 className="mt-0.5 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
        {greeting(today)}
        {name ? `, ${name}` : ""}
      </h2>
      <div className={cn("mt-5 grid gap-2 sm:gap-3", deliveredToday === undefined ? "grid-cols-2" : "grid-cols-3")}>
        <HeroStat label="Active jobs" value={activeCount} />
        <HeroStat label="Overdue" value={overdueCount} tone="alert" />
        {deliveredToday === undefined ? null : (
          <HeroStat label="Delivered today" value={deliveredToday ?? 0} loading={deliveredToday === null} />
        )}
      </div>
    </HeroSurface>
  );
}

function DriverPortalView() {
  const view = useAppStore((s) => s.view);
  const focusDelivery = useAppStore((s) => s.focusDelivery);
  const isHistory = view === "driver-history";
  const [busyId, setBusyId] = useState<string | null>(null);
  const [podJob, setPodJob] = useState<MyJob | null>(null);
  const [reportJob, setReportJob] = useState<MyJob | null>(null);

  const active = useApiData<{ items: MyJob[] }>("/api/my/jobs");
  // History also feeds the "Delivered today" stat on the Jobs page.
  const history = useApiData<{ items: MyJob[] }>("/api/my/jobs?scope=history");

  const transition = async (job: MyJob, status: Transition) => {
    setBusyId(job.id);
    try {
      await api.post(`/api/deliveries/${job.id}/status`, { status });
      toast.success(status === "PICKED_UP" ? "Pickup confirmed — package is with you" : "Delivery started — you are on the way");
      useAppStore.getState().bump(); // refetches the job list too
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the job");
      active.reload(); // the job may have been cancelled or reassigned meanwhile
    } finally {
      setBusyId(null);
    }
  };

  const handlers: JobHandlers = {
    busyId,
    onTransition: transition,
    onOpenPod: setPodJob,
    onOpenReport: setReportJob,
    onOpenDetail: (job) => focusDelivery(job.id),
  };

  const activeItems = (active.data?.items ?? []).slice().sort(byUrgency);
  const [nextStop, ...upNext] = activeItems;
  const overdueCount = activeItems.filter(isOverdue).length;
  const deliveredToday = history.data
    ? history.data.items.filter((j) => {
        const endedAt = jobEndedAt(j);
        return jobOutcome(j) === "DELIVERED" && !!endedAt && isToday(new Date(endedAt));
      }).length
    : history.error
      ? undefined
      : null;

  let jobsContent: React.ReactNode;
  if (active.loading && !active.data) {
    jobsContent = <JobsSkeleton />;
  } else if (active.error && !active.data) {
    jobsContent = (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorCard message={active.error} onRetry={active.reload} />
      </div>
    );
  } else if (!nextStop) {
    jobsContent = (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <JobsHero activeCount={0} overdueCount={0} deliveredToday={deliveredToday} />
        <CaughtUpState />
      </div>
    );
  } else {
    jobsContent = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
        <div className="flex flex-col gap-5 lg:sticky lg:top-20">
          <JobsHero activeCount={activeItems.length} overdueCount={overdueCount} deliveredToday={deliveredToday} />
          <NextStopCard key={nextStop.id} job={nextStop} h={handlers} />
        </div>
        <section aria-labelledby="up-next-heading" className="@container">
          <h2 id="up-next-heading" className="mb-3 flex items-baseline justify-between px-1 text-base font-semibold tracking-tight">
            Up next
            <span className="text-sm font-normal tabular-nums text-muted-foreground">
              {upNext.length} {upNext.length === 1 ? "job" : "jobs"}
            </span>
          </h2>
          {upNext.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[15px] text-muted-foreground dark:border-white/15">
              Nothing else queued — focus on your next stop.
            </p>
          ) : (
            <div className="grid gap-3 @lg:grid-cols-2">
              {upNext.map((job, i) => (
                <JobCard key={job.id} job={job} h={handlers} index={i} />
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      {isHistory ? (
        <HistoryPanel
          items={history.data?.items ?? null}
          loading={history.loading}
          error={history.error}
          onRetry={history.reload}
        />
      ) : (
        jobsContent
      )}

      {podJob ? (
        <PodDialog
          job={podJob}
          onClose={() => setPodJob(null)}
          onCompleted={() => {
            useAppStore.getState().bump();
            setPodJob(null);
          }}
          onFailed={active.reload}
        />
      ) : null}

      {reportJob ? (
        <ReportProblemDialog
          job={reportJob}
          onClose={() => setReportJob(null)}
          onReported={() => {
            useAppStore.getState().bump();
            setReportJob(null);
          }}
          onFailed={active.reload}
        />
      ) : null}

      <JobDetailDialog />
    </div>
  );
}

export default DriverPortalView;
export { DriverPortalView };
