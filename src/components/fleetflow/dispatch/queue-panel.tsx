"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, FileUp, MapPin, Plus, Search, SearchX, UserCheck, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { failureReasonLabel } from "@/lib/constants";
import type { Delivery } from "@/lib/types";
import { goToDeliveriesAction } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PriorityMarker } from "@/components/fleetflow/driver/ui";
import { CARD_SURFACE, ENTER_MOTION, PRESS, splitAddress } from "@/components/fleetflow/driver/job-utils";
import { DueText, SectionLabel, TrackingLink, areaOf, dueTime, isPastDue } from "./helpers";

type Filter = "all" | "overdue" | "failed" | "priority";
type Sort = "priority" | "due" | "area";

const isHigh = (d: Delivery) => d.priority === "URGENT" || d.priority === "HIGH";

// ── Row ───────────────────────────────────────────────────────

function QueueRow({
  delivery: d,
  nowMs,
  selected,
  onToggle,
  onAssign,
  index,
}: {
  delivery: Delivery;
  nowMs: number;
  selected: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onAssign: (d: Delivery) => void;
  index: number;
}) {
  const { line1, line2 } = splitAddress(d.deliveryAddress);
  const checkboxId = `queue-select-${d.id}`;
  return (
    <li
      className={cn(
        "group relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 px-2 py-3 transition-colors duration-150",
        // phone: stacked card
        "rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:border-white/10 dark:shadow-none",
        // ≥md: flat list row inside the shared surface
        "md:grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(7.5rem,auto)_auto] md:items-center md:gap-x-4 md:rounded-none md:border-0 md:bg-transparent md:px-3 md:shadow-none",
        "hover:bg-muted/40 focus-within:bg-muted/40 dark:hover:bg-white/[0.03]",
        selected && "bg-primary/[0.05] ring-1 ring-primary/30 ring-inset md:ring-0 dark:bg-primary/10",
        ENTER_MOTION,
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms`, animationFillMode: "backwards" }}
    >
      <label
        htmlFor={checkboxId}
        className="row-span-3 -my-1 flex size-11 cursor-pointer items-center justify-center self-start rounded-lg md:row-span-1 md:self-center"
      >
        <Checkbox
          id={checkboxId}
          checked={selected}
          onCheckedChange={(c) => onToggle(d.id, c === true)}
          aria-label={`Select ${d.trackingCode}`}
          className="size-[18px] rounded-[5px]"
        />
      </label>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TrackingLink delivery={d} />
          <PriorityMarker priority={d.priority} className="h-6 px-2 text-[11px]" />
        </div>
        <p className="mt-0.5 truncate text-sm font-medium">{d.recipientName}</p>
      </div>

      <div className="col-start-2 min-w-0 md:col-start-auto">
        <p className="flex items-start gap-1.5 text-sm">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground md:hidden" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate">{line1}</span>
            {line2 ? <span className="block truncate text-xs text-muted-foreground">{line2}</span> : null}
          </span>
        </p>
        {d.status === "FAILED" ? (
          <span className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-600/15 dark:bg-rose-950/60 dark:text-rose-300">
            <span className="size-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden="true" />
            <span className="truncate">Failed · {failureReasonLabel(d.failureReason)}</span>
          </span>
        ) : null}
      </div>

      <div className="col-start-2 md:col-start-auto">
        <DueText delivery={d} nowMs={nowMs} />
      </div>

      <div className="col-span-2 mt-1.5 md:col-span-1 md:mt-0">
        <Button
          type="button"
          variant="outline"
          onClick={() => onAssign(d)}
          aria-label={`Assign ${d.trackingCode}`}
          className={cn(
            "h-11 w-full rounded-xl font-medium md:h-9 md:w-auto",
            "md:border-transparent md:bg-transparent md:shadow-none",
            "group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground",
            "group-focus-within:border-primary group-focus-within:bg-primary group-focus-within:text-primary-foreground",
            "dark:group-hover:bg-primary dark:group-focus-within:bg-primary",
            PRESS,
          )}
        >
          <UserCheck aria-hidden="true" /> Assign
        </Button>
      </div>
    </li>
  );
}

function RowList({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className={cn(
        "space-y-2 md:space-y-0 md:divide-y md:divide-border/60 md:overflow-hidden md:dark:divide-white/[0.07]",
        "md:rounded-2xl md:border md:border-border/70 md:bg-card md:shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.15)] md:dark:border-white/10 md:dark:shadow-none",
      )}
    >
      {children}
    </ul>
  );
}

// ── Empty states ──────────────────────────────────────────────

export function QueueClear() {
  return (
    <div className={cn(CARD_SURFACE, ENTER_MOTION, "flex flex-col items-center px-6 py-12 text-center")}>
      <div className="relative mb-5 size-20" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-primary/10" />
        <span className="absolute inset-3 rounded-full bg-primary/15" />
        <span className="absolute inset-6 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <CheckCircle2 className="size-5" />
        </span>
      </div>
      <h3 className="text-lg font-semibold tracking-tight">Queue clear — every delivery has a driver</h3>
      <p className="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">
        New and failed deliveries land here for dispatch. Add more work or import a batch from a spreadsheet.
      </p>
      <div className="mt-5 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button className={cn("min-h-11 rounded-xl font-semibold sm:min-h-10", PRESS)} onClick={() => goToDeliveriesAction("create")}>
          <Plus aria-hidden="true" /> New delivery
        </Button>
        <Button variant="outline" className={cn("min-h-11 rounded-xl sm:min-h-10", PRESS)} onClick={() => goToDeliveriesAction("import")}>
          <FileUp aria-hidden="true" /> Import
        </Button>
      </div>
    </div>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className={cn(CARD_SURFACE, "flex flex-col items-center px-6 py-10 text-center")}>
      <SearchX className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 font-medium">No deliveries match</p>
      <p className="mt-1 text-sm text-muted-foreground">Try a different search or filter.</p>
      <Button variant="outline" className="mt-4 min-h-11 rounded-xl sm:min-h-9" onClick={onClear}>
        Clear search and filters
      </Button>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────

export function QueuePanel({
  queue,
  nowMs,
  selected,
  onToggle,
  onToggleMany,
  onAssign,
}: {
  queue: Delivery[];
  nowMs: number;
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onToggleMany: (ids: string[], checked: boolean) => void;
  onAssign: (d: Delivery) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("priority");
  const [grouped, setGrouped] = useState(false);

  const attention = (d: Delivery) => d.status === "FAILED" || isPastDue(d, nowMs);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter((d) =>
      [d.trackingCode, d.recipientName, d.deliveryAddress, d.externalRef ?? ""].some((s) => s.toLowerCase().includes(q)),
    );
  }, [queue, query]);

  const counts = {
    all: searched.length,
    overdue: searched.filter((d) => isPastDue(d, nowMs)).length,
    failed: searched.filter((d) => d.status === "FAILED").length,
    priority: searched.filter(isHigh).length,
  };

  const visible = useMemo(() => {
    const order = new Map(queue.map((d, i) => [d.id, i]));
    const rank = (d: Delivery) => order.get(d.id) ?? 0;
    const list = searched.filter((d) =>
      filter === "overdue" ? isPastDue(d, nowMs) : filter === "failed" ? d.status === "FAILED" : filter === "priority" ? isHigh(d) : true,
    );
    return [...list].sort((a, b) => {
      if (sort === "due") return dueTime(a) - dueTime(b) || rank(a) - rank(b);
      if (sort === "area") return areaOf(a).localeCompare(areaOf(b)) || rank(a) - rank(b);
      return rank(a) - rank(b); // API order: URGENT > HIGH > NORMAL > LOW, then due
    });
  }, [queue, searched, filter, sort, nowMs]);

  const sections = useMemo(() => {
    if (grouped) {
      const map = new Map<string, Delivery[]>();
      for (const d of visible) {
        const a = areaOf(d);
        map.set(a, [...(map.get(a) ?? []), d]);
      }
      return [...map.entries()]
        .sort(([a], [b]) => (a === "No area" ? 1 : b === "No area" ? -1 : a.localeCompare(b)))
        .map(([title, items]) => ({ key: `area-${title}`, title, items }));
    }
    const needs = visible.filter(attention);
    const waiting = visible.filter((d) => !attention(d));
    return [
      { key: "attention", title: "Needs attention", items: needs },
      { key: "waiting", title: "Waiting", items: waiting },
    ].filter((s) => s.items.length > 0);
  }, [visible, grouped, nowMs]);

  const visibleIds = visible.map((d) => d.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id)).length;
  const allChecked = visibleIds.length > 0 && selectedVisible === visibleIds.length;

  if (queue.length === 0) return <QueueClear />;

  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "overdue", label: "Overdue" },
    { key: "failed", label: "Failed" },
    { key: "priority", label: "Urgent & high" },
  ];

  let rowIndex = 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, recipient or address"
              aria-label="Search the queue"
              className="h-11 rounded-xl bg-card pl-9 sm:h-10 dark:bg-input/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger aria-label="Sort the queue" className="h-11 min-h-11 flex-1 rounded-xl bg-card sm:h-10 sm:min-h-10 sm:w-40 sm:flex-none dark:bg-input/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="priority">Sort: Priority</SelectItem>
                <SelectItem value="due">Sort: Due soonest</SelectItem>
                <SelectItem value="area">Sort: Area</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex h-11 items-center gap-2 rounded-xl border border-border/70 bg-card px-3 sm:h-10 dark:border-white/10 dark:bg-input/30">
              <Switch id="queue-group-area" checked={grouped} onCheckedChange={setGrouped} />
              <Label htmlFor="queue-group-area" className="cursor-pointer text-sm font-medium whitespace-nowrap">
                Group by area
              </Label>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter the queue" className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0">
            {chips.map((c) => {
              const active = filter === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(c.key)}
                  className={cn(
                    "inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors duration-150 outline-none sm:h-8",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active
                      ? "bg-foreground text-background"
                      : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/5 dark:hover:bg-white/10",
                  )}
                >
                  {c.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      active ? "bg-background/20" : c.key === "overdue" && counts.overdue > 0 ? "text-rose-700 dark:text-rose-400" : "",
                    )}
                  >
                    {counts[c.key]}
                  </span>
                </button>
              );
            })}
          </div>
          {visibleIds.length > 0 ? (
            <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:min-h-8">
              <Checkbox
                checked={allChecked ? true : selectedVisible > 0 ? "indeterminate" : false}
                onCheckedChange={(c) => onToggleMany(visibleIds, c === true)}
                aria-label={`Select all ${visibleIds.length} shown deliveries`}
                className="size-[18px] rounded-[5px]"
              />
              Select all <span className="tabular-nums">({visibleIds.length})</span>
            </label>
          ) : null}
        </div>
      </div>

      {/* Rows */}
      {visible.length === 0 ? (
        <NoMatches
          onClear={() => {
            setQuery("");
            setFilter("all");
          }}
        />
      ) : (
        <div className="space-y-6">
          {sections.map((s) => (
            <section key={s.key} aria-label={`${s.title}, ${s.items.length}`}>
              <SectionLabel count={s.items.length}>
                {grouped ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {s.title}
                  </span>
                ) : s.key === "attention" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-rose-500" aria-hidden="true" />
                    {s.title}
                  </span>
                ) : (
                  s.title
                )}
              </SectionLabel>
              <RowList>
                {s.items.map((d) => (
                  <QueueRow
                    key={d.id}
                    delivery={d}
                    nowMs={nowMs}
                    selected={selected.has(d.id)}
                    onToggle={onToggle}
                    onAssign={onAssign}
                    index={rowIndex++}
                  />
                ))}
              </RowList>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bulk action bar ───────────────────────────────────────────

export function BulkBar({ count, onAssign, onClear }: { count: number; onAssign: () => void; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.25)] backdrop-blur",
        "md:sticky md:inset-x-auto md:bottom-4 md:mx-auto md:mt-4 md:w-fit md:rounded-2xl md:border md:px-2 md:py-2 md:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]",
        "dark:border-white/10 dark:bg-zinc-900/95",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200",
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        <span className="pl-1 text-sm font-semibold tabular-nums md:pl-2" aria-live="polite">
          {count} selected
        </span>
        <Button className={cn("ml-auto min-h-11 rounded-xl font-semibold shadow-sm md:ml-2 md:min-h-9", PRESS)} onClick={onAssign}>
          <Users aria-hidden="true" /> Assign to…
        </Button>
        <Button variant="ghost" className="min-h-11 rounded-xl md:min-h-9" onClick={onClear}>
          <X aria-hidden="true" /> Clear
        </Button>
      </div>
    </div>
  );
}
