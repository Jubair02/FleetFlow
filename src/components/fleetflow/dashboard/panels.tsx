"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flame,
  Info,
  Link2,
  ShieldAlert,
  StickyNote,
  UserMinus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STATUS_ICONS } from "@/components/fleetflow/badges";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardData } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CARD_SURFACE, ENTER_MOTION } from "@/components/fleetflow/driver/job-utils";
import { AvailabilityDot, LoadBar, Squircle, availabilityLabel } from "@/components/fleetflow/dispatch/helpers";
import { CHART_TOOLTIP_STYLE, dayTick, dayTooltipLabel } from "@/components/fleetflow/date-range";
import type { AttentionItem, AttentionKind, StatusSegment } from "@/components/fleetflow/dashboard/model";

// ── Shared panel chrome ──────────────────────────────────────

const LINK_BUTTON =
  "inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary transition-colors duration-150 outline-none hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-9";

export function Panel({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn(CARD_SURFACE, "flex flex-col p-4 sm:p-5", ENTER_MOTION, className)}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="-mt-1 -mr-2 shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function PanelLink({ onClick, children, label }: { onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button type="button" onClick={onClick} className={LINK_BUTTON} aria-label={label}>
      {children}
      <ArrowRight className="size-4" aria-hidden="true" />
    </button>
  );
}

// ── Needs attention ──────────────────────────────────────────

const ATTENTION_META: Record<AttentionKind, { icon: LucideIcon; label: (n: number) => string; tone: "rose" | "amber" }> = {
  overdue: { icon: Clock, label: (n) => (n === 1 ? "Overdue delivery" : "Overdue deliveries"), tone: "rose" },
  failed: { icon: AlertTriangle, label: () => "Failed — waiting for re-dispatch", tone: "rose" },
  urgent: { icon: Flame, label: () => "Urgent or high priority, no driver yet", tone: "amber" },
  vehicles: { icon: Wrench, label: (n) => (n === 1 ? "Vehicle off the road" : "Vehicles off the road"), tone: "amber" },
};

const TONE_ICON = {
  rose: "bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-400/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/15 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-400/20",
} as const;

const TONE_COUNT = {
  rose: "text-rose-700 dark:text-rose-300",
  amber: "text-amber-800 dark:text-amber-300",
} as const;

export function NeedsAttention({
  items,
  actionFor,
}: {
  items: AttentionItem[];
  actionFor: (item: AttentionItem) => { label: string; run: () => void };
}) {
  const total = items.reduce((n, i) => n + i.count, 0);
  return (
    <Panel
      id="needs-attention-heading"
      title="Needs attention"
      description={items.length === 0 ? undefined : "Most pressing first"}
      action={
        total > 0 ? (
          <span className="mt-2 mr-2 inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {total} {total === 1 ? "item" : "items"}
          </span>
        ) : null
      }
    >
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50/70 px-4 py-4 dark:bg-emerald-950/30">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">All clear</p>
            <p className="text-sm text-muted-foreground">Nothing overdue, failed or stuck waiting. Vehicles are all on the road.</p>
          </div>
        </div>
      ) : (
        <ul className="-mx-2 flex flex-col divide-y divide-border/60 dark:divide-white/10">
          {items.map((item) => {
            const meta = ATTENTION_META[item.kind];
            const Icon = meta.icon;
            const action = actionFor(item);
            return (
              <li key={item.kind} className="flex items-center gap-3 px-2 py-3">
                <span
                  className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", TONE_ICON[meta.tone])}
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">
                    <span className={cn("mr-1.5 font-semibold tabular-nums", TONE_COUNT[meta.tone])}>{item.count}</span>
                    {meta.label(item.count)}
                  </p>
                  {item.context ? (
                    <p className="mt-0.5 line-clamp-2 text-xs sm:line-clamp-none sm:truncate tabular-nums text-muted-foreground" title={item.context}>
                      {item.context}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={action.run}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-border bg-background px-3 text-sm font-medium transition-[background-color,transform] duration-150 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:active:scale-[0.98] sm:min-h-9 dark:bg-input/30 dark:hover:bg-input/50"
                  aria-label={`${action.label}: ${item.count} ${meta.label(item.count).toLowerCase()}`}
                >
                  {action.label}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ── Performance ──────────────────────────────────────────────

const CHART = { delivered: "#10b981", failed: "#f43f5e", created: "#71717a" } as const;

const SEGMENT_STYLE: Record<StatusSegment["key"], string> = {
  waiting: "bg-zinc-400 dark:bg-zinc-500",
  progress: "bg-emerald-300 dark:bg-emerald-700",
  delivered: "bg-emerald-600 dark:bg-emerald-400",
  failed: "bg-rose-500",
  cancelled: "bg-zinc-200 dark:bg-zinc-700",
};

function SummaryStat({ label, value, info }: { label: string; value: string; info?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {info}
      </dt>
      <dd className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}

function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        className="-my-3 -ml-1 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:size-6 sm:my-0"
        aria-label={label}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm leading-relaxed">{children}</PopoverContent>
    </Popover>
  );
}

export function PerformanceCard({
  daily,
  totals,
  stats,
  segments,
  onOpenReports,
}: {
  daily: DashboardData["daily"];
  totals: { created: number; delivered: number; failed: number };
  stats: DashboardData["stats"];
  segments: StatusSegment[];
  onOpenReports: () => void;
}) {
  const resolved = stats.completed + stats.failed;
  const successRate = resolved > 0 ? Math.round((stats.completed / resolved) * 100) : null;
  const totalDeliveries = segments.reduce((n, s) => n + s.count, 0);

  return (
    <Panel
      id="performance-heading"
      title="Performance · last 14 days"
      action={<PanelLink onClick={onOpenReports}>Full reports</PanelLink>}
    >
      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-muted/50 px-3 py-3 sm:px-4 dark:bg-white/5">
        <SummaryStat label="Delivered" value={String(totals.delivered)} />
        <SummaryStat
          label="Success"
          value={successRate == null ? "—" : `${successRate}%`}
          info={
            <InfoPopover label="How the success rate is calculated">
              Delivered ÷ (delivered + failed), across all deliveries by their current status. Cancelled and unfinished
              deliveries are left out.
            </InfoPopover>
          }
        />
        <SummaryStat
          label="On time"
          value={stats.onTimeRate == null ? "—" : `${stats.onTimeRate}%`}
          info={
            <InfoPopover label="How the on-time rate is calculated">
              Share of delivered deliveries with a deadline that were completed at or before it (all time). Deliveries
              without a deadline are left out
              {stats.deliveredWithoutDeadline ? ` (${stats.deliveredWithoutDeadline} so far)` : ""}.
            </InfoPopover>
          }
        />
      </dl>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Chart legend">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: CHART.delivered }} aria-hidden="true" />
          Delivered
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: CHART.failed }} aria-hidden="true" />
          Failed attempts
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: CHART.created }} aria-hidden="true" />
          Created
        </li>
      </ul>

      <figure className="mt-2">
        <figcaption className="sr-only">
          Last 14 days: {totals.delivered} delivered, {totals.failed} failed attempts, {totals.created} created.
        </figcaption>
        <div className="h-[180px] sm:h-[220px]" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(113,113,122,0.2)" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tick={{ fontSize: 11, fill: "currentColor" }}
                className="text-muted-foreground"
                tickFormatter={dayTick}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={38}
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "currentColor" }}
                className="text-muted-foreground"
              />
              <Tooltip
                cursor={{ fill: "rgba(113,113,122,0.08)" }}
                contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
                labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
                labelFormatter={dayTooltipLabel}
              />
              <Bar dataKey="completed" name="Delivered" fill={CHART.delivered} radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="failed" name="Failed attempts" fill={CHART.failed} radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Line dataKey="total" name="Created" stroke={CHART.created} strokeWidth={2} dot={false} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <div className="mt-4 border-t border-border/60 pt-4 dark:border-white/10">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">All deliveries by status</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{totalDeliveries} total</span>
        </div>
        <div className="mt-2 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <span key={s.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", SEGMENT_STYLE[s.key])} style={{ width: `${s.share}%` }} />
            ))}
        </div>
        <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-5">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={cn("size-2 shrink-0 rounded-full", SEGMENT_STYLE[s.key])} aria-hidden="true" />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="ml-auto font-medium tabular-nums sm:ml-1">{s.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

// ── Drivers ──────────────────────────────────────────────────

export function DriversPanel({
  drivers,
  total,
  onOpenDispatch,
  onOpenDrivers,
}: {
  drivers: DashboardData["driverWorkload"];
  total: number;
  onOpenDispatch: () => void;
  onOpenDrivers: () => void;
}) {
  return (
    <Panel
      id="drivers-heading"
      title="Drivers"
      description={total > drivers.length ? `Showing ${drivers.length} of ${total}` : undefined}
      action={<PanelLink onClick={onOpenDispatch}>Dispatch board</PanelLink>}
    >
      {drivers.length === 0 ? (
        <div className="flex flex-col items-start gap-2 py-2">
          <p className="text-sm text-muted-foreground">No drivers yet. Add one to start dispatching.</p>
          <PanelLink onClick={onOpenDrivers}>Add a driver</PanelLink>
        </div>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {drivers.map((w) => (
            <li key={w.id} className={cn("flex items-center gap-3 rounded-xl px-1 py-2", !w.active && "opacity-60")}>
              <Squircle name={w.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{w.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AvailabilityDot driver={w} />
                  {availabilityLabel(w)}
                </p>
              </div>
              <LoadBar driver={w} className="w-24 shrink-0 sm:w-28" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Recent activity ──────────────────────────────────────────

const EVENT_ICONS: Record<string, LucideIcon> = {
  ...STATUS_ICONS,
  NOTE: StickyNote,
  UNASSIGNED: UserMinus,
  TRACKING_UPDATED: Link2,
  OVERRIDE: ShieldAlert,
};

function eventTone(type: string): string {
  if (type === "DELIVERED") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
  if (type === "FAILED" || type === "OVERRIDE") return "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300";
  return "bg-muted text-muted-foreground";
}

export function ActivityPanel({
  events,
  onOpenDelivery,
  onOpenAudit,
}: {
  events: DashboardData["recentEvents"];
  onOpenDelivery: (id: string) => void;
  onOpenAudit: () => void;
}) {
  return (
    <Panel id="activity-heading" title="Recent activity" action={<PanelLink onClick={onOpenAudit}>Audit log</PanelLink>}>
      {events.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No activity yet. Events show up here as deliveries move.</p>
      ) : (
        <ol className="flex flex-col">
          {events.map((ev) => {
            const Icon = EVENT_ICONS[ev.eventType] ?? Clock;
            const label = EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType;
            return (
              <li key={ev.id} className="flex items-center gap-3 py-1.5">
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", eventTone(ev.eventType))} aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
                    <span className="font-medium">{label}</span>
                    <button
                      type="button"
                      onClick={() => onOpenDelivery(ev.deliveryId)}
                      className="-my-2.5 inline-flex min-h-11 items-center rounded-md px-1 font-mono text-[13px] font-semibold tracking-wide underline-offset-4 transition-colors outline-none hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:-my-1 sm:min-h-7"
                      aria-label={`Open delivery ${ev.trackingCode}`}
                    >
                      {ev.trackingCode}
                    </button>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {ev.actorName ? `${ev.actorName} · ` : ""}
                    <time dateTime={ev.createdAt}>{timeAgo(ev.createdAt)}</time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
