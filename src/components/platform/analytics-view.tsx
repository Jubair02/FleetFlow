"use client";

import { format, isValid, parseISO } from "date-fns";
import { BarChart3 } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlatformOverview, PlatformPlansData } from "@/lib/platform-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_TOOLTIP_STYLE, dayTick, dayTooltipLabel } from "@/components/fleetflow/date-range";
import { usePlatformData } from "./platform-api";
import { EmptyState, ErrorState, fmtNum, PageHeader, SUBSCRIPTION_LABELS } from "./shared";

const COLORS = {
  emerald: "#10b981",
  teal: "#14b8a6",
  violet: "#8b5cf6",
  cyan: "#06b6d4",
  amber: "#f59e0b",
  rose: "#f43f5e",
  zinc: "#71717a",
  zincLight: "#a1a1aa",
} as const;

/** Plans are data now — colour them by catalog position, falling back to grey for unknown codes. */
const PLAN_PALETTE = [COLORS.zincLight, COLORS.teal, COLORS.emerald, COLORS.violet, COLORS.cyan, COLORS.amber, COLORS.rose];

const SUB_COLORS: Record<string, string> = {
  TRIAL: COLORS.zincLight,
  ACTIVE: COLORS.emerald,
  PAST_DUE: COLORS.amber,
  CANCELLED: COLORS.rose,
};

const GRID = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(113,113,122,0.2)" />;
const AXIS_TICK = { fontSize: 12, fill: "currentColor" } as const;

/** "YYYY-MM" → Date at the 1st (local). */
function monthDate(value: unknown): Date | null {
  const d = parseISO(`${String(value).slice(0, 7)}-01`);
  return isValid(d) ? d : null;
}
const monthTick = (v: unknown) => {
  const d = monthDate(v);
  return d ? format(d, "MMM") : String(v);
};
const monthLabel = (v: unknown) => {
  const d = monthDate(v);
  return d ? format(d, "MMMM yyyy") : String(v);
};

function ChartEmpty({ height, text }: { height: number; text: string }) {
  return (
    <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
      {text}
    </div>
  );
}

function MonthlyBar({ data, dataKey, name, color }: { data: PlatformOverview["monthly"]; dataKey: "organizations" | "deliveries"; name: string; color: string }) {
  const total = data.reduce((s, m) => s + m[dataKey], 0);
  if (total === 0) return <ChartEmpty height={220} text="Nothing in the last 12 months." />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tick={AXIS_TICK} className="text-muted-foreground" tickFormatter={monthTick} />
        <YAxis tickLine={false} axisLine={false} width={38} allowDecimals={false} tick={AXIS_TICK} className="text-muted-foreground" />
        <Tooltip
          cursor={{ fill: "rgba(113,113,122,0.08)" }}
          contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
          labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
          labelFormatter={monthLabel}
          formatter={(v: number) => [fmtNum(v), name]}
        />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Distribution({ rows, colorOf, labelOf, noun }: { rows: { key: string; count: number }[]; colorOf: (k: string) => string; labelOf: (k: string) => string; noun: string }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return <ChartEmpty height={200} text={`No ${noun} yet.`} />;
  const data = rows.filter((r) => r.count > 0).map((r) => ({ ...r, name: labelOf(r.key), color: colorOf(r.key) }));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE.contentStyle} labelStyle={CHART_TOOLTIP_STYLE.labelStyle} itemStyle={{ color: "var(--popover-foreground)" }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">{fmtNum(total)}</span>
          <span className="text-xs text-muted-foreground">{noun}</span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-1.5">
        {data.map((d) => (
          <li key={d.key} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
            <span className="truncate text-muted-foreground">{d.name}</span>
            <span className="ml-auto font-medium tabular-nums">{fmtNum(d.count)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round((d.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalyticsView() {
  const { data, error, reload } = usePlatformData<PlatformOverview>("/api/platform/overview");
  // Plan names & order for the "by plan" chart; codes are shown until this loads (or if it fails).
  const { data: plansData } = usePlatformData<PlatformPlansData>("/api/platform/plans");
  const planIndex = new Map((plansData?.plans ?? []).map((p, i) => [p.code, { name: p.name, i }]));
  const planLabel = (code: string) => planIndex.get(code)?.name ?? code;
  const planColor = (code: string) => {
    const found = planIndex.get(code);
    return found ? PLAN_PALETTE[found.i % PLAN_PALETTE.length] : COLORS.zinc;
  };

  if (error && !data) return <ErrorState title="Couldn't load analytics" message={error} onRetry={reload} />;
  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading analytics">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className={i === 2 ? "h-80 w-full rounded-xl lg:col-span-2" : "h-72 w-full rounded-xl"} />
        ))}
      </div>
    );
  }

  const dailyTotal = data.daily.reduce((s, d) => s + d.deliveries, 0);
  const noData = data.organizations.total === 0 && data.deliveries.total === 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Analytics" description="Platform growth and usage. Months and days are UTC." />
      {error && <ErrorState title="Showing the last loaded figures" message={error} onRetry={reload} />}
      {noData ? (
        <Card>
          <EmptyState icon={BarChart3} title="No data yet" description="Charts fill in once organizations are created and start dispatching deliveries." />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New organizations</CardTitle>
                <CardDescription className="text-xs">Per month, last 12 months</CardDescription>
              </CardHeader>
              <CardContent>
                <MonthlyBar data={data.monthly} dataKey="organizations" name="New organizations" color={COLORS.violet} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Deliveries created</CardTitle>
                <CardDescription className="text-xs">Per month, last 12 months, all organizations</CardDescription>
              </CardHeader>
              <CardContent>
                <MonthlyBar data={data.monthly} dataKey="deliveries" name="Deliveries" color={COLORS.emerald} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily deliveries</CardTitle>
              <CardDescription className="text-xs">
                Last 30 days · {fmtNum(dailyTotal)} total · {fmtNum(Math.round(dailyTotal / Math.max(1, data.daily.length)))} per day on average
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dailyTotal === 0 ? (
                <ChartEmpty height={260} text="No deliveries in the last 30 days." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.daily} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    {GRID}
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tick={AXIS_TICK} className="text-muted-foreground" tickFormatter={dayTick} />
                    <YAxis tickLine={false} axisLine={false} width={38} allowDecimals={false} tick={AXIS_TICK} className="text-muted-foreground" />
                    <Tooltip
                      cursor={{ stroke: "rgba(113,113,122,0.35)", strokeDasharray: "3 3" }}
                      contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
                      labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
                      labelFormatter={dayTooltipLabel}
                      formatter={(v: number) => [fmtNum(v), "Deliveries"]}
                    />
                    <Area dataKey="deliveries" name="Deliveries" stroke={COLORS.emerald} fill={COLORS.emerald} fillOpacity={0.12} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Organizations by plan</CardTitle>
                <CardDescription className="text-xs">Current plan of each organization</CardDescription>
              </CardHeader>
              <CardContent>
                <Distribution
                  rows={data.organizations.byPlan.map((p) => ({ key: p.plan, count: p.count }))}
                  colorOf={planColor}
                  labelOf={planLabel}
                  noun="organizations"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Subscription status</CardTitle>
                <CardDescription className="text-xs">As recorded manually by FleetFlow staff</CardDescription>
              </CardHeader>
              <CardContent>
                <Distribution
                  rows={data.organizations.bySubscription.map((s) => ({ key: s.status, count: s.count }))}
                  colorOf={(k) => SUB_COLORS[k] ?? COLORS.zinc}
                  labelOf={(k) => SUBSCRIPTION_LABELS[k] ?? k}
                  noun="organizations"
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
