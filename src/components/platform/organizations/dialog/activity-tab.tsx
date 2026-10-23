"use client";

import { Activity, ScrollText, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { PlatformOrgDetail } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, humanizeAction, parseDetail } from "../../shared";
import { mergeActivity } from "./org-dialog-utils";

function detailText(detail: string | null): string | null {
  const parsed = parseDetail(detail);
  if (!parsed) return null;
  return typeof parsed === "string" ? parsed : parsed.map((d) => `${d.key}: ${d.value}`).join(" · ");
}

/** Company audit entries and FleetFlow staff actions, newest first (latest 20 of each). */
export function ActivityTab({ detail, onOpenAudit }: { detail: PlatformOrgDetail; onOpenAudit: () => void }) {
  const items = mergeActivity(detail.recentActivity, detail.platformActions);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Latest company activity and FleetFlow staff actions.</p>
        <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={onOpenAudit}>
          <ScrollText aria-hidden /> Platform audit log
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Activity} title="No activity recorded" description="Company actions and FleetFlow staff actions on this organization appear here." />
      ) : (
        <ol className="relative flex flex-col">
          {items.map((a) => {
            const platform = a.source === "platform";
            const extra = platform ? detailText(a.detail) : a.entityType;
            return (
              <li key={a.id} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
                <span
                  className={cn(
                    "relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background",
                    platform ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" : "bg-muted text-muted-foreground"
                  )}
                  aria-hidden
                >
                  {platform ? <ShieldCheck className="size-3.5" /> : <Activity className="size-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <span className="font-medium">{humanizeAction(a.action)}</span>
                      <span className="text-muted-foreground"> · {a.actorName ?? "System"}</span>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                      {timeAgo(a.createdAt)}
                    </time>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={cn("shrink-0 font-medium", platform && "text-violet-700 dark:text-violet-300")}>{platform ? "FleetFlow staff" : "Company"}</span>
                    {extra && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="line-clamp-2 break-words">{extra}</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading activity">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
