"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import type { Paged, PlatformOrgDeliveryRow } from "@/lib/platform-types";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/fleetflow/badges";
import { usePlatformData, withQuery } from "../../platform-api";
import { EmptyState, ErrorState, PaginationBar } from "../../shared";
import { orgUrl } from "../org-api";

const PAGE_SIZE = 10;

function Driver({ name }: { name: string | null }) {
  return name ? <span className="truncate">{name}</span> : <span className="text-muted-foreground italic">Unassigned</span>;
}

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {timeAgo(iso)}
    </time>
  );
}

/** Recent deliveries (read-only). No tracking tokens or recipient contact details are ever loaded. */
export function DeliveriesTab({ orgId }: { orgId: string }) {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = usePlatformData<Paged<PlatformOrgDeliveryRow>>(withQuery(`${orgUrl(orgId)}/deliveries`, { page, pageSize: PAGE_SIZE }));

  if (error && !data) return <ErrorState title="Couldn't load deliveries" message={error} onRetry={reload} />;
  if (!data) return <DeliveriesSkeleton />;
  if (data.total === 0) {
    return <EmptyState icon={Package} title="No deliveries yet" description="Deliveries this company creates will appear here." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorState title="Showing the last loaded page" message={error} onRetry={reload} />}
      <div className={cn("overflow-hidden rounded-xl border", loading && "opacity-60 transition-opacity")} aria-busy={loading}>
        {/* ≥ sm: table */}
        <table className="hidden w-full text-sm sm:table">
          <caption className="sr-only">Recent deliveries</caption>
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Tracking code</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Recipient</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Driver</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Created</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Expected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {data.items.map((d) => (
              <tr key={d.id}>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{d.trackingCode}</td>
                <td className="max-w-40 truncate px-3 py-2.5">{d.recipientName}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={d.status} />
                </td>
                <td className="max-w-36 truncate px-3 py-2.5">
                  <Driver name={d.driverName} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  <When iso={d.createdAt} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{d.expectedAt ? formatDate(d.expectedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* < sm: list */}
        <ul className="divide-y divide-border/70 sm:hidden">
          {data.items.map((d) => (
            <li key={d.id} className="flex flex-col gap-1.5 px-3 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{d.trackingCode}</span>
                <StatusBadge status={d.status} />
              </div>
              <div className="truncate font-medium">{d.recipientName}</div>
              <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <Driver name={d.driverName} />
                <span aria-hidden>·</span>
                <span>
                  Created <When iso={d.createdAt} />
                </span>
                {d.expectedAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span>Expected {formatDate(d.expectedAt)}</span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <PaginationBar page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} noun="deliveries" onPage={setPage} disabled={loading} />
      </div>
    </div>
  );
}

export function DeliveriesSkeleton() {
  return (
    <div className="flex flex-col divide-y rounded-xl border" aria-busy="true" aria-label="Loading deliveries">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="hidden h-3.5 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}
