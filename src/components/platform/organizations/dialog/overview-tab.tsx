"use client";

import { CheckCircle2, Package, Truck, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { RESOURCE_LABELS } from "@/lib/plan-catalog";
import type { PlatformOrgDetail } from "@/lib/platform-types";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout, fmtNum, UsageBar } from "../../shared";
import { PlanPill, StatusPill } from "../org-parts";
import { RESOURCE_ORDER } from "./org-form-dialog";
import { formatRate } from "./org-dialog-utils";

function Stat({ icon: Icon, label, value, hint, tint }: { icon: LucideIcon; label: string; value: string; hint?: string; tint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", tint)} aria-hidden>
          <Icon className="size-3.5" />
        </span>
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</div>
      {hint && <div className="-mt-1 truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function DetailList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("divide-y divide-border/70", className)}>{children}</dl>;
}

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,38%)_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">{children}</h3>
      {action}
    </div>
  );
}

const muted = (v: string | null | undefined) => (v ? v : <span className="text-muted-foreground">—</span>);

export function OverviewTab({ detail }: { detail: PlatformOrgDetail }) {
  const org = detail.organization;
  const { stats } = detail;
  const suspended = org.status === "SUSPENDED";
  return (
    <div className="flex flex-col gap-6">
      {suspended && (
        <Callout tone="rose" className="text-sm">
          <div className="font-medium">Suspended{org.suspendedAt ? ` on ${formatDateTime(org.suspendedAt)}` : ""}</div>
          <div className="mt-0.5">Reason: {org.suspendedReason || "—"}</div>
          <div className="mt-1 text-xs opacity-90">Staff and drivers can&apos;t sign in. Data is preserved and customer tracking links keep working.</div>
        </Callout>
      )}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          icon={Users}
          label="Users"
          value={fmtNum(stats.users.total)}
          hint={`${fmtNum(stats.users.admins)} admin${stats.users.admins === 1 ? "" : "s"} · ${fmtNum(stats.users.drivers)} driver${stats.users.drivers === 1 ? "" : "s"}`}
          tint="bg-sky-500/10 text-sky-600 dark:text-sky-400"
        />
        <Stat icon={Truck} label="Vehicles" value={fmtNum(detail.usage.vehicles)} hint="In service" tint="bg-teal-500/10 text-teal-600 dark:text-teal-400" />
        <Stat icon={Package} label="Deliveries (30d)" value={fmtNum(stats.deliveries30d)} hint="Created in the last 30 days" tint="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
        <Stat
          icon={CheckCircle2}
          label="Success rate (30d)"
          value={formatRate(stats.successRate30d)}
          hint={stats.successRate30d === null ? "No finished deliveries yet" : `${fmtNum(stats.delivered30d)} delivered · ${fmtNum(stats.failed30d)} failed`}
          tint="bg-primary/10 text-primary"
        />
      </section>

      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <section>
          <SectionTitle>Organization</SectionTitle>
          <DetailList>
            <DetailRow label="Plan">
              <PlanPill code={detail.planDetail.code} name={detail.planDetail.name} inactive={!detail.planDetail.active} />
            </DetailRow>
            <DetailRow label="Account status">
              <StatusPill status={org.status} />
              {suspended && org.suspendedReason && <span className="mt-1 block text-xs text-muted-foreground">{org.suspendedReason}</span>}
            </DetailRow>
            <DetailRow label="Registered">
              {formatDate(org.createdAt)} <span className="text-xs text-muted-foreground">· {timeAgo(org.createdAt)}</span>
            </DetailRow>
            <DetailRow label="Timezone">{org.timezone}</DetailRow>
            <DetailRow label="Phone">{muted(org.phone)}</DetailRow>
            <DetailRow label="Address">{muted(org.address)}</DetailRow>
          </DetailList>
        </section>
        <section>
          <SectionTitle>Usage vs plan limits</SectionTitle>
          <ul className="flex flex-col gap-4 pt-1">
            {RESOURCE_ORDER.map((r) => (
              <UsageBar key={r} label={RESOURCE_LABELS[r]} used={detail.usage[r] ?? 0} limit={detail.limits[r] ?? null} />
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">Active users and vehicles; deliveries this calendar month in {org.timezone}.</p>
        </section>
      </div>
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
