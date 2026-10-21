"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw, ScrollText, Search } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApiData } from "@/lib/api-client";
import { formatDateTime, initials, timeAgo, truncate } from "@/lib/format";
import type { AuditItem } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── presentation helpers ─────────────────────────────────────

interface AuditPageData {
  items: AuditItem[];
  total: number;
  page: number;
  pageCount: number;
}

const ENTITY_OPTIONS = [
  { value: "ALL", label: "All types" },
  { value: "Delivery", label: "Delivery" },
  { value: "User", label: "User" },
  { value: "Vehicle", label: "Vehicle" },
];

function actionTint(action: string): string {
  const a = action.toUpperCase();
  if (a.includes("CREATED") || a.includes("REGISTERED")) {
    return "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
  }
  if (a.includes("OVERRIDE")) {
    return "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
  }
  if (a.includes("FAILED") || a.includes("DELETED") || a.includes("CANCELLED")) {
    return "border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300";
  }
  return "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300";
}

function prettyDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

// ── row ──────────────────────────────────────────────────────

function AuditRow({ item }: { item: AuditItem }) {
  return (
    <TableRow>
      <TableCell className="align-top whitespace-nowrap">
        <p className="text-sm">{formatDateTime(item.createdAt)}</p>
        <p className="text-xs text-muted-foreground">{timeAgo(item.createdAt)}</p>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-6">
            <AvatarFallback className="bg-primary/10 text-[10px] font-medium text-primary">
              {initials(item.actorName)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm whitespace-nowrap">{item.actorName}</span>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <Badge
          variant="outline"
          className={cn("font-mono text-xs whitespace-nowrap", actionTint(item.action))}
        >
          {item.action}
        </Badge>
      </TableCell>
      <TableCell className="align-top">
        <p className="text-sm">{item.entityType}</p>
        <p className="font-mono text-xs text-muted-foreground" title={item.entityId}>
          {truncate(item.entityId, 12)}
        </p>
      </TableCell>
      <TableCell className="max-w-[300px] align-top">
        {item.detail ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="View full detail"
                className="block max-w-[280px] truncate text-left text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {item.detail}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96">
              <p className="mb-2 font-mono text-xs text-muted-foreground">{item.action}</p>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                {prettyDetail(item.detail)}
              </pre>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── main view ────────────────────────────────────────────────

export function AuditView() {
  const [entityType, setEntityType] = useState("ALL");
  const [actionInput, setActionInput] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (entityType !== "ALL") params.set("entityType", entityType);
    if (action.trim()) params.set("action", action.trim());
    params.set("page", String(page));
    return `/api/audit?${params.toString()}`;
  }, [entityType, action, page]);

  // useApiData refetches whenever `url` changes (filters / page) and drops stale responses.
  const { data, loading, error, reload } = useApiData<AuditPageData>(url);

  const items = data?.items ?? [];
  const pageCount = Math.max(1, data?.pageCount ?? 1);
  const total = data?.total ?? 0;

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setAction(actionInput.trim());
    setPage(1);
  };

  const reset = () => {
    setEntityType("ALL");
    setActionInput("");
    setAction("");
    setPage(1);
  };

  const showEmpty = !loading && !error && items.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Audit log</h2>
        <p className="text-sm text-muted-foreground">
          Immutable trail of every action taken in your organization.
        </p>
      </div>

      {/* Filter bar */}
      <Card className="p-4">
        <form onSubmit={applyFilters} className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="space-y-1.5 md:w-48">
            <Label htmlFor="audit-entity">Entity type</Label>
            <Select
              value={entityType}
              onValueChange={(v) => {
                setEntityType(v);
                setPage(1);
              }}
            >
              <SelectTrigger id="audit-entity" className="w-full">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="audit-action">Action</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="audit-action"
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                placeholder="Filter by action e.g. DRIVER_ASSIGNED"
                maxLength={100}
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="min-h-10 flex-1 md:flex-none">
              Apply
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={reset}
              className="min-h-10 flex-1 md:flex-none"
            >
              <RotateCcw aria-hidden /> Reset
            </Button>
          </div>
        </form>
      </Card>

      {error && !loading ? (
        <Card className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-destructive">Failed to load audit log: {error}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="overflow-x-auto p-0">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-40" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : showEmpty ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <div className="flex flex-col items-center gap-2 py-12 text-center">
                        <ScrollText className="size-10 text-muted-foreground/50" aria-hidden />
                        <p className="font-medium">
                          {page > pageCount ? "No entries on this page." : "No audit entries match your filters."}
                        </p>
                        {page > pageCount ? (
                          <Button variant="outline" size="sm" onClick={() => setPage(pageCount)}>
                            Go to page {pageCount}
                          </Button>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Try a different entity type or clear the action filter.
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => <AuditRow key={item.id} item={item} />)
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total} record{total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="min-h-11 sm:min-h-9"
          >
            <ChevronLeft aria-hidden /> Prev
          </Button>
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="min-h-11 sm:min-h-9"
          >
            Next <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AuditView;
