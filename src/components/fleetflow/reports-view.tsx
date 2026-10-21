"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Download,
  Filter,
  Info,
  Loader2,
  Package,
  PackageCheck,
  RotateCcw,
  Route,
  Timer,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PriorityBadge, StatusBadge } from "@/components/fleetflow/badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, useApiData } from "@/lib/api-client";
import {
  CHART_TOOLTIP_STYLE,
  dayTick,
  dayTooltipLabel,
  isRangeInverted,
  rangeFromParam,
  rangeToParam,
} from "@/components/fleetflow/date-range";
import {
  DELIVERY_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  failureReasonLabel,
  type DeliveryStatus,
  type Priority,
} from "@/lib/constants";
import { downloadCsv, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DriverItem, ReportData, VehicleItem } from "@/lib/types";

// ── Constants ────────────────────────────────────────────────

const COLORS = {
  emerald: "#10b981",
  rose: "#f43f5e",
  zinc: "#71717a",
} as const;

/** Radix Select requires non-empty item values — sentinel for "no filter". */
const ALL = "__all__";

const SCROLLBAR =
  "[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700";

interface ReportFilters {
  from: string;
  to: string;
  driverId: string;
  vehicleId: string;
  status: string;
  priority: string;
}

const EMPTY_FILTERS: ReportFilters = { from: "", to: "", driverId: "", vehicleId: "", status: "", priority: "" };
const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof ReportFilters)[];

/** Timeliness of a delivered row (see src/lib/report-metrics.ts → classifyTimeliness). */
const TIMELINESS: Record<string, { label: string; className: string }> = {
  ON_TIME: { label: "On time", className: "font-medium text-emerald-600 dark:text-emerald-400" },
  LATE: { label: "Late", className: "font-medium text-amber-600 dark:text-amber-400" },
  NO_DEADLINE: { label: "No deadline", className: "text-muted-foreground" },
  NO_COMPLETION_TIME: { label: "No completion time", className: "text-muted-foreground" },
};

// ── Formatting ───────────────────────────────────────────────

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const hrs = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)} h`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── Metric definitions (mirror src/lib/report-metrics.ts) ────

const METRIC_DEFINITIONS: { term: string; definition: string }[] = [
  {
    term: "Total",
    definition:
      "Deliveries created in the selected date range that match the filters. Status counts use each delivery's current status.",
  },
  {
    term: "Pending dispatch / In progress",
    definition: "Pending dispatch = created but not yet assigned. In progress = assigned, picked up or in transit.",
  },
  {
    term: "Success rate",
    definition:
      "Delivered ÷ (delivered + failed). Cancelled and still-open deliveries are left out. Shown as — when nothing has been delivered or failed yet.",
  },
  {
    term: "On-time rate",
    definition:
      "Deliveries completed on or before their expected time ÷ delivered deliveries that have an expected time. Deliveries without a deadline are excluded — they are never counted as on time.",
  },
  { term: "Late", definition: "Delivered after the expected time." },
  {
    term: "Avg completion",
    definition:
      "Mean (and median) hours from creation to delivery, over delivered deliveries. Rows with a missing timestamp are excluded and counted.",
  },
  {
    term: "Time on the road",
    definition:
      "Hours from assignment to delivery for the driver who delivered it. Rows with a missing timestamp are excluded and counted.",
  },
  {
    term: "Per driver",
    definition:
      "Assigned = distinct deliveries ever given to the driver. Delivered / Failed = the driver's assignments that ended that way (each failed attempt counts). Failure % = failed ÷ (delivered + failed). On-time % uses the same deadline rule over the deliveries that driver completed.",
  },
];

function MetricDefinitions() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-muted-foreground">
          <Info className="size-4" aria-hidden="true" /> How metrics are calculated
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,440px)]">
        <p className="text-sm font-semibold">How metrics are calculated</p>
        <dl className={cn("mt-3 flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto pr-1", SCROLLBAR)}>
          {METRIC_DEFINITIONS.map((m) => (
            <div key={m.term}>
              <dt className="text-xs font-medium">{m.term}</dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">{m.definition}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
          Rates are whole percentages; durations are rounded to 0.1 h. Dates use the report&apos;s date range (creation date).
        </p>
      </PopoverContent>
    </Popover>
  );
}

// ── Small building blocks ────────────────────────────────────

type Tone = "emerald" | "amber" | "rose" | "teal" | "zinc";

const TONE_STYLES: Record<Tone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone: Tone;
}) {
  return (
    <Card className="gap-0">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={hint}>
            {hint}
          </p>
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", TONE_STYLES[tone])}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function FailureReasons({ rows, failed }: { rows: ReportData["failureReasons"]; failed: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Failure reasons</CardTitle>
        <CardDescription className="text-xs">
          {failed === 0 ? "Deliveries currently failed, by reason" : `${plural(failed, "delivery", "deliveries")} currently failed, by reason`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No failed deliveries in this range.</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.reason} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{r.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    <span className="font-medium text-foreground">{r.count}</span>
                    {failed > 0 ? ` · ${Math.round((r.count / failed) * 100)}%` : ""}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full bg-rose-500/80" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Filter field wrapper ─────────────────────────────────────

function FilterField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────

export default function ReportsView() {
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<ReportFilters>(EMPTY_FILTERS);

  const [rangeError, setRangeError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const appliedUrl = useMemo(() => {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = applied[key];
      if (!value) continue;
      // Dates go out as instants in the viewer's local time: from inclusive, to exclusive.
      if (key === "from") {
        const from = rangeFromParam(value);
        if (from) params.set("from", from);
      } else if (key === "to") {
        const to = rangeToParam(value);
        if (to) params.set("to", to);
      } else {
        params.set(key, value);
      }
    }
    params.set("tz", String(new Date().getTimezoneOffset()));
    return `/api/reports?${params.toString()}`;
  }, [applied]);

  const { data, loading, error } = useApiData<ReportData>(appliedUrl);
  const driversQ = useApiData<{ items: DriverItem[] }>("/api/drivers");
  const vehiclesQ = useApiData<{ items: VehicleItem[] }>("/api/vehicles");

  const setFilter = (key: keyof ReportFilters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    if (key === "from" || key === "to") setRangeError(null);
  };

  const handleApply = () => {
    if (isRangeInverted(filters.from, filters.to)) {
      setRangeError("“From” must be on or before “To”.");
      return;
    }
    setRangeError(null);
    setApplied(filters);
  };
  const handleReset = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setRangeError(null);
  };

  const activeCount = FILTER_KEYS.filter((k) => applied[k]).length;
  const hasPending = FILTER_KEYS.some((k) => filters[k] !== applied[k]);

  const summary = data?.summary;
  const daily = data?.daily ?? [];
  const driverRows = useMemo(() => data?.driverBreakdown ?? [], [data]);
  const items = data?.items ?? [];
  const itemsTotal = data?.itemsTotal ?? items.length;

  const bestOnTime = useMemo(() => {
    let best: number | null = null;
    for (const row of driverRows) {
      if (row.onTimeRate != null && (best == null || row.onTimeRate > best)) best = row.onTimeRate;
    }
    return best;
  }, [driverRows]);

  // Export re-fetches the applied report with export=1 so every matching row is included.
  const handleExport = async () => {
    if (!data || exporting) return;
    setExporting(true);
    let full: ReportData;
    try {
      full = await api.get<ReportData>(`${appliedUrl}&export=1`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
      setExporting(false);
      return;
    }
    const rows: (string | number | null)[][] = [
      ["Tracking", "Recipient", "Driver", "Vehicle", "Status", "Priority", "Created", "Expected", "Completed", "Timeliness", "Failure reason"],
      ...full.items.map((it) => [
        it.trackingCode,
        it.recipientName,
        it.driverName ?? "",
        it.vehicleRegistration ?? "",
        STATUS_LABELS[it.status as DeliveryStatus] ?? it.status,
        PRIORITY_LABELS[it.priority as Priority] ?? it.priority,
        it.createdAt ? formatDate(it.createdAt) : "",
        it.expectedAt ? formatDateTime(it.expectedAt) : "",
        it.completedAt ? formatDateTime(it.completedAt) : "",
        it.timeliness ? (TIMELINESS[it.timeliness]?.label ?? it.timeliness) : "",
        it.status === "FAILED" ? failureReasonLabel(it.failureReason) : "",
      ]),
    ];
    downloadCsv("fleetflow-report.csv", rows);
    toast.success(`Exported ${full.items.length} ${full.items.length === 1 ? "delivery" : "deliveries"}`);
    setExporting(false);
  };

  // The driver breakdown is never capped, so it exports straight from the loaded report.
  const handleDriverExport = () => {
    if (driverRows.length === 0) return;
    const rows: (string | number | null)[][] = [
      [
        "Driver",
        "Assigned (deliveries)",
        "Delivered",
        "Failed attempts",
        "Failure rate %",
        "On time",
        "Late",
        "Delivered without deadline (excluded from on-time)",
        "On-time rate %",
        "Avg time on the road (h)",
        "Excluded from road time (missing timestamps)",
      ],
      ...driverRows.map((r) => [
        r.driverName,
        r.assigned,
        r.delivered,
        r.failed,
        r.failureRate ?? "",
        r.onTime,
        r.late,
        r.deliveredWithoutDeadline,
        r.onTimeRate ?? "",
        r.avgRoadHours ?? "",
        r.roadTimeExcluded,
      ]),
    ];
    downloadCsv("fleetflow-driver-performance.csv", rows);
    toast.success(`Exported ${plural(driverRows.length, "driver", "drivers")}`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Filter bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report filters</CardTitle>
          <CardDescription className="text-xs">Narrow the report by date, driver, vehicle, status or priority</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <FilterField id="rep-from" label="From">
              <Input
                id="rep-from"
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => setFilter("from", e.target.value)}
                aria-invalid={!!rangeError}
                aria-describedby={rangeError ? "rep-range-error" : undefined}
                className="bg-background"
              />
            </FilterField>
            <FilterField id="rep-to" label="To">
              <Input
                id="rep-to"
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => setFilter("to", e.target.value)}
                aria-invalid={!!rangeError}
                aria-describedby={rangeError ? "rep-range-error" : undefined}
                className="bg-background"
              />
            </FilterField>
            <FilterField id="rep-driver" label="Driver">
              <Select value={filters.driverId || ALL} onValueChange={(v) => setFilter("driverId", v === ALL ? "" : v)}>
                <SelectTrigger id="rep-driver" className="w-full bg-background">
                  <SelectValue placeholder="All drivers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All drivers</SelectItem>
                  {(driversQ.data?.items ?? []).map((dr) => (
                    <SelectItem key={dr.id} value={dr.id}>
                      {dr.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField id="rep-vehicle" label="Vehicle">
              <Select value={filters.vehicleId || ALL} onValueChange={(v) => setFilter("vehicleId", v === ALL ? "" : v)}>
                <SelectTrigger id="rep-vehicle" className="w-full bg-background">
                  <SelectValue placeholder="All vehicles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All vehicles</SelectItem>
                  {(vehiclesQ.data?.items ?? []).map((vh) => (
                    <SelectItem key={vh.id} value={vh.id}>
                      {vh.registrationNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField id="rep-status" label="Status">
              <Select value={filters.status || ALL} onValueChange={(v) => setFilter("status", v === ALL ? "" : v)}>
                <SelectTrigger id="rep-status" className="w-full bg-background">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {DELIVERY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField id="rep-priority" label="Priority">
              <Select value={filters.priority || ALL} onValueChange={(v) => setFilter("priority", v === ALL ? "" : v)}>
                <SelectTrigger id="rep-priority" className="w-full bg-background">
                  <SelectValue placeholder="All priorities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All priorities</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>

          {rangeError ? (
            <p id="rep-range-error" role="alert" className="text-sm text-destructive">
              {rangeError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{activeCount === 0 ? "No filters applied" : `${activeCount} filter${activeCount === 1 ? "" : "s"} applied`}</span>
              {activeCount > 0 && (
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                  {activeCount} active
                </Badge>
              )}
              {hasPending && <span className="text-amber-600 dark:text-amber-400">unapplied changes</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="size-4" aria-hidden="true" /> Reset
              </Button>
              <Button size="sm" onClick={handleApply}>
                <Filter className="size-4" aria-hidden="true" /> Apply report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && !data ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Failed to load report</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : !data ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Card key={i} className="gap-0">
                <CardContent className="flex flex-col gap-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-28" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
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
          <Card>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "pointer-events-none opacity-60")} aria-busy={loading}>
          {/* Summary cards */}
          <section aria-labelledby="rep-summary-title" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="rep-summary-title" className="text-sm font-medium text-muted-foreground">
                Summary
              </h2>
              <MetricDefinitions />
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
              <SummaryCard icon={Package} tone="zinc" label="Total deliveries" value={String(summary?.total ?? 0)} hint="created in selected range" />
              <SummaryCard
                icon={PackageCheck}
                tone="emerald"
                label="Delivered"
                value={String(summary?.completed ?? 0)}
                hint={`${summary?.cancelled ?? 0} cancelled`}
              />
              <SummaryCard
                icon={CircleDashed}
                tone="zinc"
                label="Pending dispatch"
                value={String(summary?.pendingDispatch ?? 0)}
                hint="created, not yet assigned"
              />
              <SummaryCard
                icon={Truck}
                tone="teal"
                label="In progress"
                value={String(summary?.inProgress ?? 0)}
                hint="assigned · picked up · in transit"
              />
              <SummaryCard icon={AlertTriangle} tone="rose" label="Failed" value={String(summary?.failed ?? 0)} hint="currently failed" />
              <SummaryCard
                icon={CheckCircle2}
                tone="emerald"
                label="Success rate"
                value={pct(summary?.successRate)}
                hint="delivered ÷ (delivered + failed)"
              />
              <SummaryCard
                icon={TrendingUp}
                tone="teal"
                label="On-time rate"
                value={pct(summary?.onTimeRate)}
                hint={
                  summary?.deliveredWithoutDeadline
                    ? `${summary.deliveredWithoutDeadline} delivered without a deadline — excluded`
                    : "of delivered with a deadline"
                }
              />
              <SummaryCard icon={Clock} tone="amber" label="Late deliveries" value={String(summary?.lateCount ?? 0)} hint="delivered after deadline" />
              <SummaryCard
                icon={Timer}
                tone="zinc"
                label="Avg completion"
                value={hrs(summary?.avgCompletionHours)}
                hint={`median ${hrs(summary?.medianCompletionHours)} · ${
                  summary?.completionTimeExcluded ? `${summary.completionTimeExcluded} excluded` : "created → delivered"
                }`}
              />
              <SummaryCard
                icon={Route}
                tone="zinc"
                label="Time on the road"
                value={hrs(summary?.avgRoadHours)}
                hint={`median ${hrs(summary?.medianRoadHours)} · ${
                  summary?.roadTimeExcluded ? `${summary.roadTimeExcluded} excluded` : "assigned → delivered"
                }`}
              />
            </div>
          </section>

          {/* Daily volume + failure reasons */}
          <section aria-label="Daily volume and failure reasons" className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Daily volume</CardTitle>
                <CardDescription className="text-xs">Deliveries created per day, by their current status</CardDescription>
              </CardHeader>
              <CardContent>
                {daily.length === 0 ? (
                  <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                    No deliveries in the selected range.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={daily} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
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
                        cursor={{ stroke: "rgba(113,113,122,0.35)", strokeDasharray: "3 3" }}
                        contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
                        labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
                        labelFormatter={dayTooltipLabel}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Area
                        dataKey="completed"
                        name="Delivered"
                        stroke={COLORS.emerald}
                        fill={COLORS.emerald}
                        fillOpacity={0.12}
                        strokeWidth={2}
                      />
                      <Area dataKey="failed" name="Failed" stroke={COLORS.rose} fill={COLORS.rose} fillOpacity={0.1} strokeWidth={2} />
                      <Line dataKey="total" name="Total" stroke={COLORS.zinc} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <FailureReasons rows={data.failureReasons ?? []} failed={summary?.failed ?? 0} />
          </section>

          {/* Driver performance */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="text-base">Driver performance</CardTitle>
                <CardDescription className="text-xs">
                  Results credited to the driver who held each job · on-time % counts only deliveries with a deadline
                </CardDescription>
              </div>
              <CardAction>
                <Button variant="outline" size="sm" onClick={handleDriverExport} disabled={driverRows.length === 0 || loading}>
                  <Users className="size-4" aria-hidden="true" /> Export drivers CSV
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead className="text-right">Assigned</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">Failure %</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">On-time %</TableHead>
                    <TableHead className="text-right">Avg on road</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {driverRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                        No driver activity in this range.
                      </TableCell>
                    </TableRow>
                  ) : (
                    driverRows.map((row) => {
                      const isBest = row.onTimeRate != null && row.onTimeRate === bestOnTime;
                      const onTimeNote =
                        `${row.onTime} of ${row.onTime + row.late} with a deadline` +
                        (row.deliveredWithoutDeadline > 0 ? `; ${row.deliveredWithoutDeadline} without a deadline excluded` : "");
                      return (
                        <TableRow key={row.driverId}>
                          <TableCell className="max-w-[160px] truncate font-medium">{row.driverName}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.assigned}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.delivered}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", row.failed > 0 && "text-rose-600 dark:text-rose-400")}>
                            {row.failed}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{pct(row.failureRate)}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", row.late > 0 && "text-amber-600 dark:text-amber-400")}>
                            {row.late}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-medium tabular-nums",
                              isBest ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                            )}
                            title={isBest ? `Best on-time rate — ${onTimeNote}` : onTimeNote}
                          >
                            {pct(row.onTimeRate)}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums text-muted-foreground"
                            title={row.roadTimeExcluded ? `${row.roadTimeExcluded} excluded (missing timestamps)` : undefined}
                          >
                            {hrs(row.avgRoadHours)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Delivery history */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="text-base">Delivery history</CardTitle>
                <CardDescription className="text-xs">
                  Showing {items.length} of {itemsTotal} {itemsTotal === 1 ? "delivery" : "deliveries"}
                  {itemsTotal > items.length ? " — export CSV for the full list" : ""}
                </CardDescription>
              </div>
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleExport()}
                  disabled={itemsTotal === 0 || exporting || loading}
                >
                  {exporting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="size-4" aria-hidden="true" />
                  )}{" "}
                  Export deliveries CSV
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className={cn("max-h-[480px] overflow-y-auto", SCROLLBAR)}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tracking</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead>Timeliness</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                          No deliveries match the current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((it) => {
                        const timeliness = it.timeliness ? TIMELINESS[it.timeliness] : undefined;
                        return (
                          <TableRow key={it.id}>
                            <TableCell className="font-mono text-xs">{it.trackingCode}</TableCell>
                            <TableCell className="max-w-[160px] truncate font-medium">{it.recipientName}</TableCell>
                            <TableCell className="max-w-[120px] truncate text-muted-foreground">{it.driverName ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{it.vehicleRegistration ?? "—"}</TableCell>
                            <TableCell>
                              <StatusBadge status={it.status} />
                            </TableCell>
                            <TableCell>
                              <PriorityBadge priority={it.priority} />
                            </TableCell>
                            <TableCell className="text-muted-foreground">{formatDate(it.createdAt)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {it.completedAt ? formatDateTime(it.completedAt) : "—"}
                            </TableCell>
                            <TableCell>
                              {timeliness ? (
                                <span className={timeliness.className}>{timeliness.label}</span>
                              ) : it.status === "FAILED" ? (
                                <span className="font-medium text-rose-600 dark:text-rose-400">
                                  {failureReasonLabel(it.failureReason)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export { ReportsView };
