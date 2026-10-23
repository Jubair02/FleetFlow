"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, timeAgo } from "@/lib/format";
import type { PlatformOrgRow } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtNum } from "../shared";
import { orgShortId, pageNumbers, PAGE_SIZES, showingRange, type PageSize } from "./org-list-utils";
import { OrgAvatar, PlanPill, RowActionsMenu, StatusPill, SubscriptionCell, TrendLine, type RowActionHandlers } from "./org-parts";

type CheckState = boolean | "indeterminate";

export interface ResultsProps {
  rows: PlatformOrgRow[];
  loading: boolean;
  isSelected: (id: string) => boolean;
  onToggle: (row: PlatformOrgRow, checked: boolean) => void;
  headerState: CheckState;
  onToggleAll: (checked: boolean) => void;
  handlers: RowActionHandlers;
  /** Absolute index of the first row on this page (0-based), for the "#" column. */
  offset: number;
}

/** Name + reference + email; stops row-click so the button itself is the keyboard target. */
function OrgIdentity({ row, onOpen, showMeta }: { row: PlatformOrgRow; onOpen: () => void; showMeta?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <OrgAvatar id={row.id} name={row.name} />
      <div className="min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="block max-w-full truncate rounded-sm text-left text-sm font-semibold hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {row.name}
        </button>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0 font-mono text-[11px] tracking-tight" title={row.id}>
            {orgShortId(row.id)}
          </span>
          {row.contactEmail && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate" title={row.contactEmail}>
                {row.contactEmail}
              </span>
            </>
          )}
        </div>
        {showMeta && (
          // Condensed table: columns hidden at this width (Deliveries < xl, Registered < 2xl) move here.
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground 2xl:hidden">
            <span className="tabular-nums xl:hidden">{fmtNum(row.deliveries30d)} deliveries (30d)</span>
            <span className="xl:hidden" aria-hidden>
              ·
            </span>
            <span className="truncate" title={timeAgo(row.createdAt)}>
              Registered {formatDate(row.createdAt)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function UsersCell({ row }: { row: PlatformOrgRow }) {
  return (
    <div className="tabular-nums">
      <div className="text-sm font-medium">{fmtNum(row.users)}</div>
      <div className="text-xs text-muted-foreground">
        {fmtNum(row.counts.admins)} admin{row.counts.admins === 1 ? "" : "s"}
      </div>
    </div>
  );
}

const TH = "h-11 whitespace-nowrap bg-muted/60 px-3 text-left text-xs font-medium text-muted-foreground backdrop-blur lg:sticky lg:top-14 lg:z-10 supports-[backdrop-filter]:bg-muted/80 dark:supports-[backdrop-filter]:bg-muted/70";
const TD = "px-3 py-3.5 align-middle";

// ── ≥ lg: table (condensed at lg, full at xl / 2xl) ──────────

export function OrgTable({ rows, loading, isSelected, onToggle, headerState, onToggleAll, handlers, offset }: ResultsProps) {
  return (
    <table className={cn("hidden w-full border-separate border-spacing-0 text-sm lg:table", loading && "opacity-60 transition-opacity")} aria-busy={loading}>
      <caption className="sr-only">Organizations</caption>
      <thead className="[&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl [&_th]:border-b">
        <tr>
          <th scope="col" className={cn(TH, "w-12 pl-4")}>
            <Checkbox checked={headerState} onCheckedChange={(c) => onToggleAll(c === true)} aria-label="Select all organizations on this page" />
          </th>
          <th scope="col" className={cn(TH, "w-12 pl-1 text-right tabular-nums")}>#</th>
          <th scope="col" className={TH}>Organization</th>
          <th scope="col" className={TH}>Plan</th>
          <th scope="col" className={TH}>Subscription</th>
          <th scope="col" className={TH}>Users</th>
          <th scope="col" className={cn(TH, "hidden xl:table-cell")}>Deliveries (30d)</th>
          <th scope="col" className={TH}>Status</th>
          <th scope="col" className={cn(TH, "hidden 2xl:table-cell")}>Registered</th>
          <th scope="col" className={cn(TH, "w-14 pr-4 text-right")}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="[&_tr:last-child_td]:border-b-0 [&_td]:border-b [&_td]:border-border/60">
        {rows.map((o, i) => {
          const selected = isSelected(o.id);
          return (
            <tr
              key={o.id}
              onClick={() => handlers.onView(o)}
              data-state={selected ? "selected" : undefined}
              className="cursor-pointer transition-colors hover:bg-muted/40 data-[state=selected]:bg-primary/[0.04]"
            >
              <td className={cn(TD, "pl-4")} onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={selected} onCheckedChange={(c) => onToggle(o, c === true)} aria-label={`Select ${o.name}`} />
              </td>
              <td className={cn(TD, "pl-1 text-right text-xs tabular-nums text-muted-foreground")}>{fmtNum(offset + i + 1)}</td>
              <td className={cn(TD, "max-w-0 w-[34%] xl:w-[28%]")}>
                <OrgIdentity row={o} onOpen={() => handlers.onView(o)} showMeta />
              </td>
              <td className={cn(TD, "max-w-40")}>
                <PlanPill code={o.plan} name={o.planName || o.plan} inactive={!o.planActive} />
              </td>
              <td className={cn(TD, "max-w-48")}>
                <SubscriptionCell row={o} />
              </td>
              <td className={TD}>
                <UsersCell row={o} />
              </td>
              <td className={cn(TD, "hidden xl:table-cell")}>
                <div className="text-sm font-medium tabular-nums">{fmtNum(o.deliveries30d)}</div>
                <TrendLine current={o.deliveries30d} previous={o.deliveriesPrev30d} />
              </td>
              <td className={TD}>
                <StatusPill status={o.status} />
              </td>
              <td className={cn(TD, "hidden whitespace-nowrap 2xl:table-cell")}>
                <div className="text-sm">{formatDate(o.createdAt)}</div>
                <div className="text-xs text-muted-foreground">{timeAgo(o.createdAt)}</div>
              </td>
              <td className={cn(TD, "pr-4 text-right")} onClick={(e) => e.stopPropagation()}>
                <RowActionsMenu row={o} handlers={handlers} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── < lg: stacked cards ──────────────────────────────────────

export function OrgCardList({ rows, loading, isSelected, onToggle, headerState, onToggleAll, handlers, offset }: ResultsProps) {
  return (
    <div className={cn("lg:hidden", loading && "opacity-60 transition-opacity")} aria-busy={loading}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b px-4 text-xs font-medium text-muted-foreground">
        <Checkbox checked={headerState} onCheckedChange={(c) => onToggleAll(c === true)} />
        Select all on this page
      </label>
      <ul className="divide-y divide-border/60">
        {rows.map((o, i) => {
          const selected = isSelected(o.id);
          return (
            <li key={o.id} className={cn("px-4 py-4 transition-colors", selected && "bg-primary/[0.04]")}>
              <div className="flex items-start gap-2">
                <label className="-ml-2.5 -mt-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center">
                  <Checkbox checked={selected} onCheckedChange={(c) => onToggle(o, c === true)} aria-label={`Select ${o.name}`} />
                </label>
                <div className="min-w-0 flex-1">
                  <span className="mb-0.5 block text-[11px] font-medium tabular-nums text-muted-foreground">#{fmtNum(offset + i + 1)}</span>
                  <OrgIdentity row={o} onOpen={() => handlers.onView(o)} />
                </div>
                <RowActionsMenu row={o} handlers={handlers} className="-mr-2 -mt-1.5" />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 pl-9">
                <PlanPill code={o.plan} name={o.planName || o.plan} inactive={!o.planActive} />
                <StatusPill status={o.status} />
              </div>
              <div className="mt-2.5 pl-9">
                <SubscriptionCell row={o} compact />
              </div>

              <dl className="mt-3 ml-9 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5 text-xs">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Users</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {fmtNum(o.users)}
                    <span className="block font-normal text-muted-foreground">
                      {fmtNum(o.counts.admins)} admin{o.counts.admins === 1 ? "" : "s"}
                    </span>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="truncate text-muted-foreground">Deliveries 30d</dt>
                  <dd className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-medium tabular-nums">
                    {fmtNum(o.deliveries30d)}
                    <TrendLine current={o.deliveries30d} previous={o.deliveriesPrev30d} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Registered</dt>
                  <dd className="mt-0.5 truncate font-medium" title={timeAgo(o.createdAt)}>
                    {formatDate(o.createdAt)}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Loading skeleton matching both layouts ───────────────────

export function OrgResultsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading organizations">
      <div className="hidden h-11 rounded-t-xl border-b bg-muted/60 lg:block" />
      <ul className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-4">
            <Skeleton className="hidden size-4 rounded-[4px] lg:block" />
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 lg:max-w-64">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="hidden h-5 w-20 rounded-full lg:block" />
            <div className="hidden flex-col gap-2 lg:flex">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="hidden h-8 w-10 lg:block" />
            <Skeleton className="hidden h-8 w-14 xl:block" />
            <Skeleton className="hidden h-5 w-16 rounded-full lg:block" />
            <Skeleton className="size-8 shrink-0 rounded-md" />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Footer: range, page size, pager ──────────────────────────

export function OrgPagination({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
  onPageSize,
  disabled,
}: {
  page: number;
  pageCount: number;
  pageSize: PageSize;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (s: PageSize) => void;
  disabled?: boolean;
}) {
  const { from, to } = showingRange(page, pageSize, total);
  const pages = pageNumbers(page, pageCount);
  const navBtn = "size-11 lg:size-9";
  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <p className="text-muted-foreground tabular-nums" aria-live="polite">
          Showing <span className="font-medium text-foreground">{fmtNum(from)}–{fmtNum(to)}</span> of{" "}
          <span className="font-medium text-foreground">{fmtNum(total)}</span> organization{total === 1 ? "" : "s"}
        </p>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v) as PageSize)}>
          <SelectTrigger className="h-11 w-auto shrink-0 lg:h-9" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {PAGE_SIZES.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav className="flex items-center justify-between gap-1 sm:justify-end" aria-label="Pagination">
        <Button variant="outline" size="icon" className={navBtn} onClick={() => onPage(page - 1)} disabled={disabled || page <= 1} aria-label="Previous page">
          <ChevronLeft aria-hidden />
        </Button>
        {/* Compact on phones, numbered from md. */}
        <span className="px-2 text-muted-foreground tabular-nums md:hidden">
          Page {page} of {Math.max(1, pageCount)}
        </span>
        <ul className="hidden items-center gap-1 md:flex">
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <li key={`e${i}`} className="w-8 text-center text-muted-foreground" aria-hidden>
                …
              </li>
            ) : (
              <li key={p}>
                <Button
                  variant={p === page ? "default" : "ghost"}
                  size="icon"
                  className="size-9 tabular-nums"
                  onClick={() => onPage(p)}
                  disabled={disabled && p !== page}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? "page" : undefined}
                >
                  {p}
                </Button>
              </li>
            )
          )}
        </ul>
        <Button variant="outline" size="icon" className={navBtn} onClick={() => onPage(page + 1)} disabled={disabled || page >= pageCount} aria-label="Next page">
          <ChevronRight aria-hidden />
        </Button>
      </nav>
    </div>
  );
}
