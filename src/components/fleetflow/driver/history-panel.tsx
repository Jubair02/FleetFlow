"use client";

import { AlertTriangle, CheckCircle2, History, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { failureReasonLabel } from "@/lib/constants";
import { formatTime } from "@/lib/format";
import type { MyJob } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard, HeroStat, HeroSurface } from "./job-cards";
import { CARD_SURFACE, ENTER_MOTION, dayKey, dayLabel, jobEndedAt, jobOutcome } from "./job-utils";
import { StatusPill } from "./ui";

const OUTCOME_ICON: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  DELIVERED: { icon: CheckCircle2, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300" },
  FAILED: { icon: AlertTriangle, className: "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300" },
  CANCELLED: { icon: XCircle, className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};

function HistoryRow({ job }: { job: MyJob }) {
  const outcome = jobOutcome(job);
  const endedAt = jobEndedAt(job);
  const meta = OUTCOME_ICON[outcome] ?? OUTCOME_ICON.CANCELLED;
  const Icon = meta.icon;
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
      <span className={cn("mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full", meta.className)} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-[15px] font-medium leading-snug">{job.deliveryAddress}</p>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{endedAt ? formatTime(endedAt) : "—"}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <StatusPill status={outcome} />
          <span className="font-mono text-xs tracking-wider text-muted-foreground">{job.trackingCode}</span>
          <span className="min-w-0 truncate text-sm text-muted-foreground">{job.recipientName}</span>
        </div>
        {outcome === "FAILED" ? (
          <p className="mt-1.5 text-sm text-rose-700 dark:text-rose-400">
            {job.failureReason ? failureReasonLabel(job.failureReason) : "Failed"}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function HistoryPanel({
  items,
  loading,
  error,
  onRetry,
}: {
  items: MyJob[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && !items) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5" aria-busy="true" aria-label="Loading history">
        <Skeleton className="h-40 w-full rounded-3xl" />
        <div className={cn(CARD_SURFACE, "divide-y divide-border/70")}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-6 w-1/2 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (error && !items) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorCard message={error} onRetry={onRetry} />
      </div>
    );
  }

  const list = items ?? [];
  const completedCount = list.filter((j) => jobOutcome(j) === "DELIVERED").length;
  const failedCount = list.filter((j) => jobOutcome(j) === "FAILED").length;
  const onTimeCount = list.filter((j) => {
    if (jobOutcome(j) !== "DELIVERED") return false;
    const endedAt = jobEndedAt(j);
    return !j.expectedAt || (!!endedAt && new Date(endedAt).getTime() <= new Date(j.expectedAt).getTime());
  }).length;

  // Items arrive newest-first; bucket them by the local day they ended.
  const groups: { key: string; label: string; items: MyJob[] }[] = [];
  for (const job of list) {
    const endedAt = jobEndedAt(job);
    const key = dayKey(endedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(job);
    else groups.push({ key, label: dayLabel(endedAt), items: [job] });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <HeroSurface>
        <p className="text-sm font-medium text-white/90">Your record</p>
        <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">Delivery history</h2>
        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <HeroStat label="Completed" value={completedCount} />
          <HeroStat label="Failed" value={failedCount} tone="alert" />
          <HeroStat label="On time" value={onTimeCount} />
        </div>
      </HeroSurface>

      {list.length === 0 ? (
        <div className={cn(CARD_SURFACE, ENTER_MOTION, "flex flex-col items-center px-6 py-12 text-center")}>
          <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted" aria-hidden="true">
            <History className="size-7 text-muted-foreground" />
          </span>
          <h3 className="text-lg font-semibold tracking-tight">No completed jobs yet</h3>
          <p className="mt-1.5 max-w-xs text-[15px] text-muted-foreground">Finished and failed deliveries will appear here.</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`hist-${g.key}`} className={ENTER_MOTION}>
            <h3 id={`hist-${g.key}`} className="mb-2 flex items-baseline justify-between px-1 text-sm font-semibold tracking-tight">
              {g.label}
              <span className="text-sm font-normal tabular-nums text-muted-foreground">
                {g.items.length} {g.items.length === 1 ? "job" : "jobs"}
              </span>
            </h3>
            <ul className={cn(CARD_SURFACE, "divide-y divide-border/70 overflow-hidden dark:divide-white/10")}>
              {g.items.map((job) => (
                <HistoryRow key={job.id} job={job} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
