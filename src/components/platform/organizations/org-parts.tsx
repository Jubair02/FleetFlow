"use client";

import { ArrowDownRight, ArrowUpRight, Ban, CreditCard, Eye, MoreVertical, Package, Pencil, PlayCircle, ReceiptText, Trash2, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, timeAgo } from "@/lib/format";
import type { PlatformOrgRow } from "@/lib/platform-types";
import type { OrgDialogTab } from "../console-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtNum, SUBSCRIPTION_LABELS } from "../shared";
import { formatTrend, orgInitials, paletteIndex, subscriptionLine, trendPercent } from "./org-list-utils";

// ── Deterministic categorical tints (soft, low-saturation) ───

const AVATAR_TINTS = [
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
];

const PLAN_TINTS = [
  "border-primary/20 bg-primary/10 text-primary",
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-500/10 dark:text-sky-300",
  "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-500/10 dark:text-violet-300",
  "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-500/10 dark:text-teal-300",
];

export function OrgAvatar({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 select-none items-center justify-center rounded-full text-sm font-semibold",
        AVATAR_TINTS[paletteIndex(id, AVATAR_TINTS.length)],
        className
      )}
    >
      {orgInitials(name)}
    </span>
  );
}

export function PlanPill({ code, name, inactive }: { code: string; name: string; inactive?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-xs font-medium",
        inactive
          ? "border-dashed border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
          : PLAN_TINTS[paletteIndex(code, PLAN_TINTS.length)]
      )}
      title={inactive ? "This plan is inactive — it can't be assigned to new organizations" : undefined}
    >
      <span className="truncate">{name}</span>
      {inactive && <span className="shrink-0 font-normal opacity-75">· inactive</span>}
    </span>
  );
}

/** Organization account status (Active / Suspended) — not the subscription. */
export function StatusPill({ status }: { status: string }) {
  const suspended = status === "SUSPENDED";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        suspended
          ? "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300"
          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
      )}
    >
      <span className={cn("size-1.5 rounded-full", suspended ? "bg-rose-500" : "bg-emerald-500")} aria-hidden />
      {suspended ? "Suspended" : "Active"}
    </span>
  );
}

const SUB_DOT: Record<string, string> = {
  ACTIVE: "bg-emerald-500",
  TRIAL: "bg-amber-400",
  PAST_DUE: "bg-amber-600 ring-2 ring-amber-500/25",
  CANCELLED: "bg-zinc-400 dark:bg-zinc-500",
};

export function SubscriptionCell({ row, compact = false }: { row: PlatformOrgRow; compact?: boolean }) {
  const line = subscriptionLine(row, formatDate, timeAgo);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className={cn("size-2 shrink-0 rounded-full", SUB_DOT[row.subscriptionStatus] ?? SUB_DOT.CANCELLED)} aria-hidden />
        <span className={row.subscriptionStatus === "PAST_DUE" ? "text-amber-700 dark:text-amber-400" : undefined}>
          {SUBSCRIPTION_LABELS[row.subscriptionStatus] ?? row.subscriptionStatus}
        </span>
      </div>
      {line && <div className={cn("mt-0.5 truncate text-xs text-muted-foreground", !compact && "pl-4")}>{line}</div>}
    </div>
  );
}

/** "↑ +12% vs prev. 30d" in green / rose; "—" when there is no baseline. */
export function TrendLine({ current, previous, className }: { current: number; previous: number; className?: string }) {
  const pct = trendPercent(current, previous);
  if (pct === null) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)} title="No deliveries in the previous 30 days to compare with">
        —
      </span>
    );
  }
  const up = pct > 0;
  const down = pct < 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
        up ? "text-emerald-600 dark:text-emerald-400" : down ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
        className
      )}
      title={`${fmtNum(current)} in the last 30 days vs ${fmtNum(previous)} in the 30 days before`}
    >
      {(up || down) && <Icon className="size-3.5" aria-hidden />}
      {formatTrend(pct)}
      <span className="sr-only"> versus the previous 30 days</span>
    </span>
  );
}

// ── Row actions ──────────────────────────────────────────────

export interface RowActionHandlers {
  /** Open the organization dialog (Overview unless a tab is given). */
  onView: (row: PlatformOrgRow, tab?: OrgDialogTab) => void;
  onEdit: (row: PlatformOrgRow) => void;
  onChangePlan: (row: PlatformOrgRow) => void;
  onSuspend: (row: PlatformOrgRow) => void;
  onReactivate: (row: PlatformOrgRow) => void;
  /** Open the permanent-delete confirmation (the server only deletes SUSPENDED organizations). */
  onDelete: (row: PlatformOrgRow) => void;
}

const VIEW_ITEMS: { tab: OrgDialogTab; label: string; icon: LucideIcon }[] = [
  { tab: "overview", label: "View details", icon: Eye },
  { tab: "users", label: "View users", icon: Users },
  { tab: "subscription", label: "View subscription", icon: ReceiptText },
  { tab: "deliveries", label: "View deliveries", icon: Package },
];

export function RowActionsMenu({ row, handlers, className }: { row: PlatformOrgRow; handlers: RowActionHandlers; className?: string }) {
  const suspended = row.status === "SUSPENDED";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-11 text-muted-foreground hover:text-foreground lg:size-9", className)}
          aria-label={`Actions for ${row.name}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Actions
          <span className="block truncate font-normal">{row.name}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {VIEW_ITEMS.map(({ tab, label, icon: Icon }) => (
          <DropdownMenuItem key={tab} className="min-h-11 lg:min-h-8" onSelect={() => handlers.onView(row, tab)}>
            <Icon aria-hidden /> {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 lg:min-h-8" onSelect={() => handlers.onEdit(row)}>
          <Pencil aria-hidden /> Edit organization
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 lg:min-h-8" onSelect={() => handlers.onChangePlan(row)}>
          <CreditCard aria-hidden /> Change plan
        </DropdownMenuItem>
        {suspended ? (
          <DropdownMenuItem className="min-h-11 lg:min-h-8" onSelect={() => handlers.onReactivate(row)}>
            <PlayCircle aria-hidden /> Reactivate organization
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" className="min-h-11 lg:min-h-8" onSelect={() => handlers.onSuspend(row)}>
            <Ban aria-hidden /> Suspend organization
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="min-h-11 lg:min-h-8" onSelect={() => handlers.onDelete(row)}>
          <Trash2 aria-hidden /> Delete organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── KPI card ─────────────────────────────────────────────────

export function OrgKpiCard({
  icon: Icon,
  label,
  value,
  delta,
  hint,
  tint,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  /** Real "+N this week" count; the line is omitted when undefined. */
  delta?: number;
  /** Neutral secondary line used instead of a delta. */
  hint?: string;
  tint: string;
}) {
  return (
    <Card className="gap-0 rounded-xl border-border/70 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full sm:size-12", tint)}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums sm:text-[1.75rem] sm:leading-9">{fmtNum(value)}</p>
          {delta !== undefined ? (
            delta > 0 ? (
              <p className="mt-0.5 flex items-center gap-0.5 truncate text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">+{fmtNum(delta)} this week</span>
              </p>
            ) : (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">No change this week</p>
            )
          ) : hint ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function KpiSkeleton() {
  return (
    <Card className="gap-0 rounded-xl p-4 shadow-sm sm:p-5" aria-hidden>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Skeleton className="size-10 shrink-0 rounded-full sm:size-12" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </Card>
  );
}
