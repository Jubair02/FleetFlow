"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  Package,
  RotateCcw,
  Timer,
  TrendingUp,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiData } from "@/lib/api-client";
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
          <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", TONE_STYLES[tone])}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function dayTick(value: unknown): string {
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : format(d, "d MMM");
}

function dayTooltipLabel(label: unknown): string {
  const d = new Date(String(label));
  return Number.isNaN(d.getTime()) ? String(label) : format(d, "EEE d MMM yyyy");
}

function onTimePct(completed: number, late: number): number | null {
  return completed > 0 ? Math.round(((completed - late) / completed) * 100) : null;
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

  const appliedUrl = useMemo(() => {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = applied[key];
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/api/reports?${qs}` : "/api/reports";
  }, [applied]);

  const { data, loading, error } = useApiData<ReportData>(appliedUrl);
  const driversQ = useApiData<{ items: DriverItem[] }>("/api/drivers");
  const vehiclesQ = useApiData<{ items: VehicleItem[] }>("/api/vehicles");

  const setFilter = (key: keyof ReportFilters, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  const handleApply = () => setApplied(filters);
  const handleReset = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const activeCount = FILTER_KEYS.filter((k) => applied[k]).length;
  const hasPending = FILTER_KEYS.some((k) => filters[k] !== applied[k]);

  const summary = data?.summary;
  const daily = data?.daily ?? [];
  const driverRows = data?.driverBreakdown ?? [];
  const items = data?.items ?? [];

  const bestOnTime = useMemo(() => {
    let best: number | null = null;
    for (const row of driverRows) {
      const pct = onTimePct(row.completed, row.late);
      if (pct != null && (best == null || pct > best)) best = pct;
    }
    return best;
  }, [driverRows]);

  const handleExport = () => {
    if (!data) return;
    const rows: (string | number | null)[][] = [
      ["Tracking", "Recipient", "Driver", "Vehicle", "Status", "Priority", "Created", "Expected", "Completed", "Late", "Failure reason"],
      ...data.items.map((it) => [
        it.trackingCode,
        it.recipientName,
        it.driverName ?? "",
        it.vehicleRegistration ?? "",
        STATUS_LABELS[it.status as DeliveryStatus] ?? it.status,
        PRIORITY_LABELS[it.priority as Priority] ?? it.priority,
        it.createdAt ? formatDate(it.createdAt) : "",
        it.expectedAt ? formatDateTime(it.expectedAt) : "",
        it.completedAt ? formatDateTime(it.completedAt) : "",
        it.status === "DELIVERED" ? (it.isLate ? "Late" : "On time") : "",
        it.status === "FAILED" ? failureReasonLabel(it.failureReason) : "",
      ]),
    ];
    downloadCsv("fleetflow-report.csv", rows);
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
                onChange={(e) => setFilter("from", e.target.value)}
                className="bg-background"
              />
            </FilterField>
            <FilterField id="rep-to" label="To">
              <Input
                id="rep-to"
                type="date"
                value={filters.to}
                onChange={(e) => setFilter("to", e.target.value)}
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="gap-0">
                <CardContent className="flex flex-col gap-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-28" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent>
              <Skeleton className="h-[308px] w-full" />
            </CardContent>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardContent>
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "pointer-events-none opacity-60")} aria-busy={loading}>
          {/* Summary cards */}
          <section aria-label="Report summary" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <SummaryCard icon={Package} tone="emerald" label="Total deliveries" value={String(summary?.total ?? 0)} hint="in selected range" />
            <SummaryCard
              icon={CheckCircle2}
              tone="emerald"
              label="Completion rate"
              value={summary?.completionRate == null ? "—" : `${summary.completionRate}%`}
              hint="delivered vs considered"
            />
            <SummaryCard
              icon={TrendingUp}
              tone="teal"
              label="On-time rate"
              value={summary?.onTimeRate == null ? "—" : `${summary.onTimeRate}%`}
              hint="of completed deliveries"
            />
            <SummaryCard icon={Clock} tone="amber" label="Late deliveries" value={String(summary?.lateCount ?? 0)} hint="delivered after deadline" />
            <SummaryCard icon={AlertTriangle} tone="rose" label="Failed" value={String(summary?.failed ?? 0)} hint="unsuccessful attempts" />
            <SummaryCard
              icon={Timer}
              tone="zinc"
              label="Avg completion"
              value={summary?.avgCompletionHours == null ? "—" : `${summary.avgCompletionHours.toFixed(1)} h`}
              hint="created → delivered"
            />
          </section>

          {/* Daily volume + driver performance */}
          <section aria-label="Charts and driver performance" className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily volume</CardTitle>
                <CardDescription className="text-xs">Completed, failed and total deliveries per day</CardDescription>
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
                        contentStyle={{ borderRadius: 8, fontSize: 12 }}
                        labelFormatter={dayTooltipLabel}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Area
                        dataKey="completed"
                        name="Completed"
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

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Driver performance</CardTitle>
                <CardDescription className="text-xs">Assigned, completed, failed and late jobs per driver</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Driver</TableHead>
                      <TableHead className="text-right">Assigned</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead className="text-right">Late</TableHead>
                      <TableHead className="text-right">On-time %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {driverRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                          No driver activity in this range.
                        </TableCell>
                      </TableRow>
                    ) : (
                      driverRows.map((row) => {
                        const pct = onTimePct(row.completed, row.late);
                        const isBest = pct != null && pct === bestOnTime;
                        return (
                          <TableRow key={row.driverId}>
                            <TableCell className="max-w-[140px] truncate font-medium">{row.driverName}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.completed}</TableCell>
                            <TableCell className={cn("text-right tabular-nums", row.failed > 0 && "text-rose-600 dark:text-rose-400")}>
                              {row.failed}
                            </TableCell>
                            <TableCell className={cn("text-right tabular-nums", row.late > 0 && "text-amber-600 dark:text-amber-400")}>
                              {row.late}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right font-medium tabular-nums",
                                isBest ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                              )}
                              title={isBest ? "Best on-time rate" : undefined}
                            >
                              {pct == null ? "—" : `${pct}%`}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* Delivery history */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="text-base">Delivery history</CardTitle>
                <CardDescription className="text-xs">
                  {items.length} {items.length === 1 ? "delivery" : "deliveries"} (max 500 per report)
                </CardDescription>
              </div>
              <CardAction>
                <Button variant="outline" size="sm" onClick={handleExport} disabled={items.length === 0}>
                  <Download className="size-4" aria-hidden="true" /> Export CSV
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
                      items.map((it) => (
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
                            {it.status === "DELIVERED" ? (
                              it.isLate ? (
                                <span className="font-medium text-amber-600 dark:text-amber-400">Late</span>
                              ) : (
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">On time</span>
                              )
                            ) : it.status === "FAILED" ? (
                              <span className="font-medium text-rose-600 dark:text-rose-400">
                                {failureReasonLabel(it.failureReason)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
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
