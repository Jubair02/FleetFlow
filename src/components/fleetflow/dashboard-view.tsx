"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileUp,
  Link2,
  PackagePlus,
  Package,
  ShieldAlert,
  StickyNote,
  TrendingUp,
  Truck,
  UserMinus,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AvailabilityBadge,
  PriorityBadge,
  STATUS_ICONS,
  VehicleStatusBadge,
  VehicleTypeLabel,
} from "@/components/fleetflow/badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiData } from "@/lib/api-client";
import { EVENT_TYPE_LABELS, STATUS_LABELS, failureReasonLabel, type DeliveryStatus } from "@/lib/constants";
import { formatDate, friendlyDueDate, timeAgo, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { goToDeliveries, goToDeliveriesAction, goToDelivery, useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { OnboardingChecklist } from "@/components/fleetflow/onboarding-checklist";
import { CHART_TOOLTIP_STYLE, dayTick, dayTooltipLabel } from "@/components/fleetflow/date-range";
import type { DashboardData } from "@/lib/types";

// ── Constants ────────────────────────────────────────────────

const COLORS = {
  emerald: "#10b981",
  rose: "#f43f5e",
  amber: "#f59e0b",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  zinc: "#71717a",
  zincLight: "#a1a1aa",
} as const;

const STATUS_COLORS: Record<string, string> = {
  CREATED: "#71717a",
  ASSIGNED: "#14b8a6",
  PICKED_UP: "#f59e0b",
  IN_TRANSIT: "#06b6d4",
  DELIVERED: "#10b981",
  FAILED: "#f43f5e",
  CANCELLED: "#a1a1aa",
};

const EMPTY_DASHBOARD: DashboardData = {
  stats: {
    total: 0,
    pendingAssignment: 0,
    inProgress: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    activeDrivers: 0,
    totalDrivers: 0,
    vehiclesAttention: 0,
    vehiclesTotal: 0,
    onTimeRate: null,
    lateCount: 0,
  },
  daily: [],
  statusBreakdown: [],
  priorityBreakdown: [],
  recentEvents: [],
  attention: { failedCount: 0, pendingUrgentCount: 0, failedDeliveries: [], pendingUrgent: [], maintenanceVehicles: [] },
  driverWorkload: [],
};

/** Icons for every event type (status icons + non-status events). */
const EVENT_ICONS: Record<string, LucideIcon> = {
  ...STATUS_ICONS,
  NOTE: StickyNote,
  UNASSIGNED: UserMinus,
  TRACKING_UPDATED: Link2,
  OVERRIDE: ShieldAlert,
};

const EVENT_ICON_STYLES: Record<string, string> = {
  CREATED: "bg-zinc-500/10 text-zinc-500",
  ASSIGNED: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  PICKED_UP: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  IN_TRANSIT: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  DELIVERED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  FAILED: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  CANCELLED: "bg-zinc-500/10 text-zinc-400",
  NOTE: "bg-zinc-500/10 text-zinc-500",
  UNASSIGNED: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  TRACKING_UPDATED: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  OVERRIDE: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

const SCROLLBAR =
  "[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700";

// ── Small building blocks ────────────────────────────────────

type Tone = "emerald" | "amber" | "rose" | "teal" | "zinc";

const TONE_STYLES: Record<Tone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone: Tone;
  onClick?: () => void;
}

function KpiCard({ icon: Icon, label, value, hint, tone, onClick }: KpiCardProps) {
  const interactive = Boolean(onClick);
  return (
    <Card
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${label}: ${value} — open ${label.toLowerCase()}` : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        "gap-0",
        interactive &&
          "cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      )}
    >
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", TONE_STYLES[tone])}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function AttentionRow({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {children}
    </button>
  );
}

/** Shown instead of the charts until the organization has its first delivery. */
function FirstDeliveryEmptyState() {
  return (
    <Card aria-labelledby="first-delivery-heading">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <PackagePlus className="size-6" aria-hidden="true" />
        </div>
        <div className="max-w-md">
          <h2 id="first-delivery-heading" className="text-base font-semibold">
            No deliveries yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your charts, on-time rate and driver workload fill in as soon as deliveries start moving. Add one order by hand, or bring
            in today&apos;s orders from a spreadsheet.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => goToDeliveriesAction("create")} className="min-h-11 sm:min-h-9">
            <PackagePlus aria-hidden="true" /> Create your first delivery
          </Button>
          <Button variant="outline" onClick={() => goToDeliveriesAction("import")} className="min-h-11 sm:min-h-9">
            <FileUp aria-hidden="true" /> Import from CSV
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ height, message }: { height: number; message: string }) {
  return (
    <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
      {message}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────

export function DashboardView() {
  const setView = useAppStore((s) => s.setView);
  // Daily buckets are keyed by the viewer's local date.
  const tz = new Date().getTimezoneOffset();
  const { data, loading, error } = useApiData<DashboardData>(`/api/dashboard?tz=${tz}`);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="gap-0">
              <CardContent className="flex flex-col gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent>
              <Skeleton className="h-[308px] w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Skeleton className="h-[308px] w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Failed to load dashboard</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const d = data ?? EMPTY_DASHBOARD;
  const { stats } = d;

  const pieData = d.statusBreakdown
    .filter((s) => s.count > 0)
    .map((s) => ({
      status: s.status,
      name: STATUS_LABELS[s.status as DeliveryStatus] ?? s.status,
      count: s.count,
      color: STATUS_COLORS[s.status] ?? COLORS.zinc,
    }));

  const failedList = d.attention.failedDeliveries.slice(0, 5);
  const urgentList = d.attention.pendingUrgent.slice(0, 5);
  const offRoadList = d.attention.maintenanceVehicles;
  // The lists are capped at 5 rows — badges and descriptions use the true totals.
  const failedCount = d.attention.failedCount ?? d.attention.failedDeliveries.length;
  const urgentCount = d.attention.pendingUrgentCount ?? d.attention.pendingUrgent.length;
  const offRoadCount = offRoadList.length;
  const attentionCount = failedCount + urgentCount + offRoadCount;

  return (
    <div className={cn("flex flex-col gap-6", loading && "opacity-60 transition-opacity")} aria-busy={loading}>
      <OnboardingChecklist />

      {/* KPI cards */}
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <KpiCard icon={Package} tone="emerald" label="Total deliveries" value={String(stats.total)} hint="across all statuses" />
        <KpiCard
          icon={Clock}
          tone="amber"
          label="Pending assignment"
          value={String(stats.pendingAssignment)}
          hint="awaiting dispatch"
          onClick={() => setView("dispatch")}
        />
        <KpiCard icon={Truck} tone="teal" label="In progress" value={String(stats.inProgress)} hint="assigned, picked up or in transit" />
        <KpiCard icon={CheckCircle2} tone="emerald" label="Completed" value={String(stats.completed)} hint="successfully delivered" />
        <KpiCard
          icon={AlertTriangle}
          tone="rose"
          label="Failed"
          value={String(stats.failed)}
          hint="need reassignment"
          onClick={() => goToDeliveries("FAILED")}
        />
        <KpiCard
          icon={Users}
          tone="emerald"
          label="Active drivers"
          value={`${stats.activeDrivers} / ${stats.totalDrivers}`}
          hint="active vs total drivers"
        />
        <KpiCard
          icon={Wrench}
          tone="amber"
          label="Vehicles off the road"
          value={`${stats.vehiclesAttention} / ${stats.vehiclesTotal}`}
          hint="maintenance or inactive"
        />
        <KpiCard
          icon={TrendingUp}
          tone="emerald"
          label="On-time rate"
          value={stats.onTimeRate == null ? "—" : `${stats.onTimeRate}%`}
          hint="of delivered with a deadline"
        />
      </section>

      {/* Charts — replaced by a getting-started prompt until the first delivery exists */}
      {stats.total === 0 ? (
        <FirstDeliveryEmptyState />
      ) : (
        <section aria-label="Charts" className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Deliveries — last 14 days</CardTitle>
              <CardDescription className="text-xs">Completed, failed and total volume per day</CardDescription>
            </CardHeader>
            <CardContent>
              {d.daily.length === 0 ? (
                <EmptyChart height={260} message="No delivery activity in the last 14 days." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={d.daily} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(113,113,122,0.2)" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={20}
                      tick={{ fontSize: 12, fill: "currentColor" }}
                      className="text-muted-foreground"
                      tickFormatter={dayTick}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={38}
                      allowDecimals={false}
                      tick={{ fontSize: 12, fill: "currentColor" }}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(0,0,0,0.04)" }}
                      contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
                      labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
                      labelFormatter={dayTooltipLabel}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="completed" name="Completed" fill={COLORS.emerald} radius={[4, 4, 0, 0]} maxBarSize={18} />
                    <Bar dataKey="failed" name="Failed" fill={COLORS.rose} radius={[4, 4, 0, 0]} maxBarSize={18} />
                    <Line dataKey="total" name="Total" stroke={COLORS.zinc} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status breakdown</CardTitle>
              <CardDescription className="text-xs">All deliveries by current status</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {pieData.length === 0 ? (
                <EmptyChart height={220} message="No deliveries yet." />
              ) : (
                <>
                  <div className="relative mx-auto h-[210px] w-full max-w-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="count"
                          nameKey="name"
                          innerRadius="62%"
                          outerRadius="90%"
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {pieData.map((entry) => (
                            <Cell key={entry.status} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
                          labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
                          itemStyle={{ color: "var(--popover-foreground)" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-semibold tabular-nums">{stats.total}</span>
                      <span className="text-xs text-muted-foreground">deliveries</span>
                    </div>
                  </div>
                  <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {pieData.map((s) => (
                      <li key={s.status} className="flex items-center gap-2 text-xs">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                        <span className="truncate text-muted-foreground">{s.name}</span>
                        <span className="ml-auto font-medium tabular-nums">{s.count}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Needs attention */}
      {attentionCount > 0 && (
        <section aria-labelledby="needs-attention-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="needs-attention-heading" className="text-base font-semibold">
              Needs attention
            </h2>
            {failedCount > 0 && (
              <Badge
                variant="outline"
                className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
              >
                {failedCount} failed
              </Badge>
            )}
            {urgentCount > 0 && (
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
              >
                {urgentCount} urgent
              </Badge>
            )}
            {offRoadCount > 0 && (
              <Badge variant="outline" className="bg-muted text-muted-foreground">
                {offRoadCount} off the road
              </Badge>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {failedList.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Failed — awaiting reassignment</CardTitle>
                  <CardDescription className="text-xs">
                    {failedCount} failed {failedCount === 1 ? "delivery" : "deliveries"} to re-dispatch
                    {failedCount > failedList.length ? ` — showing ${failedList.length}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {failedList.map((f) => (
                    <AttentionRow key={f.id} onClick={() => goToDelivery(f.id)} ariaLabel={`Open delivery ${f.trackingCode}`}>
                      <span className="flex items-center justify-between gap-2">
                        <code className="font-mono text-xs text-muted-foreground">{f.trackingCode}</code>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          Created {formatDate(f.createdAt)}
                        </span>
                      </span>
                      <span className="truncate text-sm font-medium">{f.recipientName}</span>
                      <span className="truncate text-xs text-rose-600 dark:text-rose-400">
                        {failureReasonLabel(f.failureReason)}
                      </span>
                    </AttentionRow>
                  ))}
                </CardContent>
              </Card>
            )}

            {urgentList.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Urgent / high — awaiting dispatch</CardTitle>
                  <CardDescription className="text-xs">
                    {urgentCount} high or urgent {urgentCount === 1 ? "delivery" : "deliveries"} awaiting dispatch
                    {urgentCount > urgentList.length ? ` — showing ${urgentList.length}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {urgentList.map((p) => (
                    <AttentionRow key={p.id} onClick={() => setView("dispatch")} ariaLabel={`Open dispatch board for ${p.trackingCode}`}>
                      <span className="flex items-center justify-between gap-2">
                        <code className="font-mono text-xs text-muted-foreground">{p.trackingCode}</code>
                        <PriorityBadge priority={p.priority} />
                      </span>
                      <span className="truncate text-sm font-medium">{p.recipientName}</span>
                      <span className="truncate text-xs text-muted-foreground">Due {friendlyDueDate(p.expectedAt)}</span>
                    </AttentionRow>
                  ))}
                </CardContent>
              </Card>
            )}

            {offRoadList.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Vehicles off the road</CardTitle>
                  <CardDescription className="text-xs">In maintenance or inactive</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {offRoadList.map((v) => (
                    <AttentionRow key={v.id} onClick={() => setView("vehicles")} ariaLabel={`Open vehicles for ${v.registrationNumber}`}>
                      <span className="flex items-center justify-between gap-2">
                        <code className="font-mono text-xs">{v.registrationNumber}</code>
                        <VehicleStatusBadge status={v.status} />
                      </span>
                      <span className="truncate text-sm font-medium">
                        <VehicleTypeLabel type={v.type} />
                      </span>
                      {v.notes && <span className="truncate text-xs text-muted-foreground">{truncate(v.notes, 56)}</span>}
                    </AttentionRow>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      {/* Driver workload + recent activity */}
      <section aria-label="Workload and activity" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Driver workload</CardTitle>
            <CardDescription className="text-xs">Active jobs against per-driver capacity</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.driverWorkload.length === 0 && <p className="text-sm text-muted-foreground">No drivers yet.</p>}
            {d.driverWorkload.map((w) => {
              const pct = w.maxActiveJobs > 0 ? Math.min(100, Math.round((w.activeJobs / w.maxActiveJobs) * 100)) : 0;
              return (
                <div key={w.id} className={cn("flex flex-col gap-2", !w.active && "opacity-60")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {w.name}
                      {!w.active && <span className="ml-1.5 font-normal text-muted-foreground">(inactive)</span>}
                    </p>
                    <AvailabilityBadge availability={w.availability} />
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={pct} aria-label={`${w.name}: ${w.activeJobs} of ${w.maxActiveJobs} active jobs`} />
                    <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {w.activeJobs}/{w.maxActiveJobs} jobs
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription className="text-xs">Latest delivery events across the fleet</CardDescription>
          </CardHeader>
          <CardContent>
            {d.recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              <ul className={cn("-mx-2 flex max-h-96 flex-col gap-1 overflow-y-auto pr-1", SCROLLBAR)}>
                {d.recentEvents.slice(0, 12).map((ev) => {
                  const Icon = EVENT_ICONS[ev.eventType] ?? Clock;
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => goToDelivery(ev.deliveryId)}
                        className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                            EVENT_ICON_STYLES[ev.eventType] ?? EVENT_ICON_STYLES.CREATED
                          )}
                        >
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">
                              {EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}
                            </span>
                            <span className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(ev.createdAt)}</span>
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                              {ev.trackingCode}
                            </code>
                            {ev.note && (
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                {truncate(ev.note, 64)}
                              </span>
                            )}
                          </span>
                          {ev.actorName && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">by {ev.actorName}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export default DashboardView;
