"use client";

import { useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarDays, Download, LoaderCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlatformPlansData } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StatusFilter } from "./org-list-utils";

export interface OrgFilters {
  search: string;
  plan: string; // "all" | plan code
  status: StatusFilter;
  range: DateRange | undefined;
}

export const EMPTY_FILTERS: OrgFilters = { search: "", plan: "all", status: "all", range: undefined };

export function hasActiveFilters(f: OrgFilters): boolean {
  return !!f.search.trim() || f.plan !== "all" || f.status !== "all" || !!f.range?.from;
}

const CONTROL = "h-11 shrink-0 bg-background lg:h-9";

export function OrgToolbar({
  filters,
  onChange,
  plans,
  plansError,
  onExport,
  exporting,
  canExport,
}: {
  filters: OrgFilters;
  onChange: (patch: Partial<OrgFilters>) => void;
  plans: PlatformPlansData | null;
  plansError: string | null;
  onExport: () => void;
  exporting: boolean;
  canExport: boolean;
}) {
  const planList = plans?.plans ?? [];
  const filtered = hasActiveFilters(filters);
  const exportButton = (className: string) => (
    <Button variant="outline" className={cn(CONTROL, className)} onClick={onExport} disabled={exporting || !canExport} aria-label="Export the filtered list as CSV">
      {exporting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      <span className="max-sm:sr-only">{exporting ? "Exporting…" : "Export"}</span>
    </Button>
  );
  return (
    <Card className="gap-0 rounded-xl border-border/70 p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-2 xl:max-w-sm xl:flex-1">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={filters.search}
              onChange={(e) => onChange({ search: e.target.value })}
              placeholder="Search by organization name, ID or email…"
              className={cn(CONTROL, "w-full pl-9")}
              aria-label="Search organizations by name, ID or email"
              maxLength={100}
            />
          </div>
          {/* Below xl the filters scroll sideways, so Export stays beside the search box. */}
          {exportButton("w-11 px-0 sm:w-auto sm:px-3 xl:hidden")}
        </div>

        {/* Filters: one row that scrolls sideways on phones instead of pushing the page wider. */}
        <div
          className="-mx-3 flex min-w-0 items-center gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] sm:-mx-4 sm:px-4 xl:mx-0 xl:flex-1 xl:overflow-visible xl:px-0 xl:pb-0 [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Filters"
        >
          <Select value={filters.plan} onValueChange={(v) => onChange({ plan: v })}>
            <SelectTrigger className={cn(CONTROL, "w-auto min-w-36")} aria-label="Filter by plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              {planList.map((p) => (
                <SelectItem key={p.code} value={p.code}>
                  {p.name}
                  {!p.active ? " (inactive)" : ""}
                </SelectItem>
              ))}
              {filters.plan !== "all" && !planList.some((p) => p.code === filters.plan) && <SelectItem value={filters.plan}>{filters.plan}</SelectItem>}
              {plansError && !plans && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground" role="note">
                  Couldn&apos;t load plans
                </div>
              )}
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(v) => onChange({ status: v as StatusFilter })}>
            <SelectTrigger className={cn(CONTROL, "w-auto min-w-40")} aria-label="Filter by account or subscription status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Account</SelectLabel>
                <SelectItem value="org:ACTIVE">Active</SelectItem>
                <SelectItem value="org:SUSPENDED">Suspended</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Subscription</SelectLabel>
                <SelectItem value="sub:ACTIVE">Paid (active subscription)</SelectItem>
                <SelectItem value="sub:TRIAL">Trial</SelectItem>
                <SelectItem value="sub:PAST_DUE">Past due</SelectItem>
                <SelectItem value="sub:CANCELLED">Cancelled</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <RegisteredRangePicker value={filters.range} onChange={(range) => onChange({ range })} />

          {filtered && (
            <Button variant="ghost" className={cn(CONTROL, "bg-transparent px-3 text-muted-foreground")} onClick={() => onChange(EMPTY_FILTERS)}>
              <X aria-hidden /> Clear
            </Button>
          )}

          {exportButton("ml-auto hidden xl:inline-flex")}
        </div>
      </div>
    </Card>
  );
}

function rangeLabel(range: DateRange | undefined): string | null {
  if (!range?.from) return null;
  const from = range.from;
  const to = range.to ?? range.from;
  if (from.toDateString() === to.toDateString()) return format(from, "d MMM yyyy");
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${format(from, sameYear ? "d MMM" : "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
}

function RegisteredRangePicker({ value, onChange }: { value: DateRange | undefined; onChange: (r: DateRange | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(value);
  const label = rangeLabel(value);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(CONTROL, "justify-start font-normal", label ? "text-foreground" : "text-muted-foreground")}
          aria-label={label ? `Registered between ${label} — change dates` : "Filter by registered date"}
        >
          <CalendarDays aria-hidden />
          {label ?? "Registered date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Registered between</p>
          <p className="text-xs text-muted-foreground">{rangeLabel(draft) ?? "Pick a start and end date"}</p>
        </div>
        <Calendar
          mode="range"
          selected={draft}
          onSelect={setDraft}
          numberOfMonths={1}
          defaultMonth={draft?.from ?? new Date()}
          disabled={{ after: new Date() }}
          className="mx-auto"
        />
        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(undefined);
              onChange(undefined);
              setOpen(false);
            }}
          >
            Clear
          </Button>
          <Button
            size="sm"
            disabled={!draft?.from}
            onClick={() => {
              onChange(draft?.from ? { from: draft.from, to: draft.to ?? draft.from } : undefined);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
