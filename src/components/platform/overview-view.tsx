"use client";

import { Building2, Ban, CheckCircle2, ChevronRight, Package, PackageCheck, Trophy, Truck, UserCog, Users } from "lucide-react";
import { STATUS_LABELS, type DeliveryStatus } from "@/lib/constants";
import type { PlatformOverview } from "@/lib/platform-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useConsole } from "./console-context";
import { usePlatformData } from "./platform-api";
import { EmptyState, ErrorState, fmtNum, KpiCard } from "./shared";

export const DELIVERY_STATUS_COLORS: Record<string, string> = {
  CREATED: "#71717a",
  ASSIGNED: "#14b8a6",
  PICKED_UP: "#f59e0b",
  IN_TRANSIT: "#06b6d4",
  DELIVERED: "#10b981",
  FAILED: "#f43f5e",
  CANCELLED: "#a1a1aa",
};

const STATUS_ORDER = ["CREATED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELLED"];

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function OverviewView() {
  const { openOrg, setView } = useConsole();
  const { data, error, reload } = usePlatformData<PlatformOverview>("/api/platform/overview");

  if (error && !data) return <ErrorState title="Couldn't load the platform overview" message={error} onRetry={reload} />;
  if (!data) return <OverviewSkeleton />;

  const { organizations: orgs, users, deliveries } = data;
  const byStatus = [...deliveries.byStatus].sort((a, b) => {
    const ia = STATUS_ORDER.indexOf(a.status);
    const ib = STATUS_ORDER.indexOf(b.status);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const statusTotal = byStatus.reduce((s, x) => s + x.count, 0);
  const topMax = Math.max(1, ...data.topOrganizations.map((o) => o.deliveriesThisMonth));

  return (
    <div className="flex flex-col gap-5">
      {error && <ErrorState title="Showing the last loaded figures" message={error} onRetry={reload} />}

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={Building2} label="Organizations" value={fmtNum(orgs.total)} hint={`${fmtNum(orgs.active)} active`} tone="emerald" />
        <KpiCard
          icon={orgs.suspended > 0 ? Ban : CheckCircle2}
          label="Suspended"
          value={fmtNum(orgs.suspended)}
          hint={orgs.suspended > 0 ? "cannot sign in" : "none suspended"}
          tone={orgs.suspended > 0 ? "rose" : "zinc"}
        />
        <KpiCard icon={Users} label="Users" value={fmtNum(users.total)} hint={users.inactive ? `${fmtNum(users.inactive)} deactivated` : "all active"} tone="teal" />
        <KpiCard icon={UserCog} label="Admins · Drivers" value={`${fmtNum(users.admins)} · ${fmtNum(users.drivers)}`} hint="across all organizations" tone="violet" />
        <KpiCard icon={Truck} label="Vehicles" value={fmtNum(data.vehicles)} hint="all organizations" tone="zinc" />
        <KpiCard icon={Package} label="Deliveries (all time)" value={fmtNum(deliveries.total)} tone="zinc" />
        <KpiCard icon={PackageCheck} label="Deliveries this month" value={fmtNum(deliveries.thisMonth)} hint="calendar month, UTC" tone="emerald" />
        <KpiCard
          icon={CheckCircle2}
          label="Active organizations"
          value={orgs.total ? `${Math.round((orgs.active / orgs.total) * 100)}%` : "—"}
          hint={`${fmtNum(orgs.active)} of ${fmtNum(orgs.total)}`}
          tone="emerald"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivery status</CardTitle>
            <CardDescription className="text-xs">Current status of every delivery on the platform</CardDescription>
          </CardHeader>
          <CardContent>
            {statusTotal === 0 ? (
              <EmptyState icon={Package} title="No deliveries yet" description="Deliveries appear here once organizations start dispatching." />
            ) : (
              <ul className="flex flex-col gap-3">
                {byStatus.map((s) => {
                  const pct = (s.count / statusTotal) * 100;
                  return (
                    <li key={s.status} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: DELIVERY_STATUS_COLORS[s.status] ?? "#71717a" }} aria-hidden />
                          {STATUS_LABELS[s.status as DeliveryStatus] ?? s.status}
                        </span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {fmtNum(s.count)} · {pct < 1 && pct > 0 ? "<1" : Math.round(pct)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: DELIVERY_STATUS_COLORS[s.status] ?? "#71717a" }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Busiest organizations</CardTitle>
            <CardDescription className="text-xs">Most deliveries created this calendar month</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topOrganizations.length === 0 ? (
              <EmptyState icon={Trophy} title="No activity this month" description="No organization has created a delivery yet this month." />
            ) : (
              <ol className="flex flex-col gap-1">
                {data.topOrganizations.map((o, i) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => openOrg(o.id)}
                      className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      aria-label={`Open ${o.name} — ${o.deliveriesThisMonth} deliveries this month`}
                    >
                      <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{o.name}</span>
                        <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${(o.deliveriesThisMonth / topMax) * 100}%` }} />
                        </span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums">{fmtNum(o.deliveriesThisMonth)}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <button
              type="button"
              onClick={() => setView("organizations")}
              className="mt-3 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              View all organizations
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
