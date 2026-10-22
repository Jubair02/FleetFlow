"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Lock, Package, Plus, Search, X } from "lucide-react";

import { useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { DeliveriesPage } from "@/lib/types";
import { DELIVERY_STATUSES, PRIORITIES, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/constants";
import { PriorityBadge, StatusBadge } from "@/components/fleetflow/badges";
import { Badge } from "@/components/ui/badge";
import { formatDate, friendlyDueDate, truncate } from "@/lib/format";
import { DeliveryDetailDialog } from "@/components/fleetflow/delivery-detail-dialog";
import { DeliveryFormDialog } from "@/components/fleetflow/delivery-form-dialog";
import { ImportDialog, TEMPLATE_URL, type ImportedBatch } from "@/components/fleetflow/import-dialog";
import { useOrgPlanInfo } from "@/components/fleetflow/plan-panel";
import { isRangeInverted, rangeFromParam, rangeToParam } from "@/components/fleetflow/date-range";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

function PaginationBar({
  data,
  loading,
  onPage,
}: {
  data: DeliveriesPage;
  loading: boolean;
  onPage: (p: number) => void;
}) {
  const start = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const end = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + data.items.length;
  return (
    <div className="flex flex-col items-center justify-between gap-3 px-4 py-3 sm:flex-row">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {start}–{end} of {data.total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 px-3"
          disabled={data.page <= 1 || loading}
          onClick={() => onPage(Math.max(1, data.page - 1))}
          aria-label="Previous page"
        >
          <ChevronLeft /> Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {data.page} of {data.pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 px-3"
          disabled={data.page >= data.pageCount || loading}
          onClick={() => onPage(Math.min(data.pageCount, data.page + 1))}
          aria-label="Next page"
        >
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function DeliveriesView() {
  // ── filters ───────────────────────────────────────────────
  // Every handler that changes a filter also resets pagination to page 1.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // A one-shot preset (e.g. dashboard "Failed" KPI) seeds the status filter on mount.
  const [statusFilter, setStatusFilter] = useState(() => useAppStore.getState().deliveriesStatusPreset ?? "ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [page, setPage] = useState(1);
  /** Set by "View imported deliveries": show exactly one import batch. */
  const [importBatch, setImportBatch] = useState<{ id: string; fileName: string } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Consume the preset so it doesn't re-apply on the next visit.
    const { deliveriesStatusPreset, setDeliveriesStatusPreset } = useAppStore.getState();
    if (deliveriesStatusPreset) setDeliveriesStatusPreset(null);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const next = value.trim();
      if (next === search) return;
      setSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleStatusChange(v: string) {
    setStatusFilter(v);
    setPage(1);
  }

  function handlePriorityChange(v: string) {
    setPriorityFilter(v);
    setPage(1);
  }

  function handleFromChange(v: string) {
    setFromDay(v);
    setPage(1);
  }

  function handleToChange(v: string) {
    setToDay(v);
    setPage(1);
  }

  function clearFilters() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchInput("");
    setSearch("");
    setStatusFilter("ALL");
    setPriorityFilter("ALL");
    setFromDay("");
    setToDay("");
    setImportBatch(null);
    setPage(1);
  }

  const rangeInverted = isRangeInverted(fromDay, toDay);
  const hasFilters =
    !!searchInput || statusFilter !== "ALL" || priorityFilter !== "ALL" || !!fromDay || !!toDay || !!importBatch;

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (importBatch) params.set("importBatchId", importBatch.id);
  if (statusFilter !== "ALL") params.set("status", statusFilter);
  if (priorityFilter !== "ALL") params.set("priority", priorityFilter);
  if (!rangeInverted) {
    const from = rangeFromParam(fromDay);
    const to = rangeToParam(toDay);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
  }
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));

  const { data, loading, error } = useApiData<DeliveriesPage>(`/api/deliveries?${params.toString()}`);

  // If the list shrank and the current page no longer exists, step back
  // (state adjusted during render, keyed on the answer for this exact page).
  if (data && !loading && data.page === page && page > data.pageCount) {
    setPage(data.pageCount);
  }

  // ── detail dialog ─────────────────────────────────────────
  // The store's focusDeliveryId is the single source of truth for "open";
  // shownId keeps the last delivery rendered so the close animation has content.
  const focusDeliveryId = useAppStore((s) => s.focusDeliveryId);
  const focusDelivery = useAppStore((s) => s.focusDelivery);
  const [shownId, setShownId] = useState<string | null>(focusDeliveryId);
  if (focusDeliveryId && focusDeliveryId !== shownId) {
    setShownId(focusDeliveryId);
  }

  function openDetail(id: string) {
    focusDelivery(id);
  }

  function handleDetailOpenChange(o: boolean) {
    if (!o) focusDelivery(null);
  }

  // ── create / import dialogs ───────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // CSV import is a plan feature. When the plan lacks it the button stays clickable
  // but the dialog explains how to upgrade instead of failing on upload.
  const { planInfo, locked } = useOrgPlanInfo();
  const importLocked = locked("csv_import");
  const importLockedHint = importLocked ? `Bulk import isn't included in your ${planInfo?.name ?? "current"} plan — see how to upgrade` : undefined;

  // One-shot action from elsewhere (e.g. dashboard "Import CSV"): open the
  // dialog during render, then clear the store so it doesn't re-open.
  const deliveriesAction = useAppStore((s) => s.deliveriesAction);
  if (deliveriesAction === "create" && !createOpen) setCreateOpen(true);
  if (deliveriesAction === "import" && !importOpen) setImportOpen(true);
  useEffect(() => {
    if (deliveriesAction) useAppStore.getState().setDeliveriesAction(null);
  }, [deliveriesAction]);

  /**
   * After an import: show exactly the deliveries from that batch. A large
   * import is saved in several batches (one per chunk) — then `batch` is null
   * and we show all deliveries newest-first, where the import is on top.
   */
  function showImported(batch: ImportedBatch) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchInput("");
    setSearch("");
    setImportBatch(batch);
    setStatusFilter("ALL");
    setPriorityFilter("ALL");
    setFromDay("");
    setToDay("");
    setPage(1);
  }

  const items = data?.items ?? [];
  const isEmpty = !loading && !error && !!data && items.length === 0;
  const showList = !!data && !isEmpty;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search tracking code, recipient, address…"
            aria-label="Search deliveries"
            className="min-h-11 pl-9 sm:min-h-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="min-h-11 w-full sm:w-48 sm:min-h-9" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {DELIVERY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={handlePriorityChange}>
          <SelectTrigger className="min-h-11 w-full sm:w-40 sm:min-h-9" aria-label="Filter by priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            type="date"
            value={fromDay}
            max={toDay || undefined}
            onChange={(e) => handleFromChange(e.target.value)}
            aria-label="Created from (inclusive)"
            aria-invalid={rangeInverted}
            className="min-h-11 flex-1 sm:w-38 sm:min-h-9 sm:flex-none"
          />
          <span className="text-sm text-muted-foreground" aria-hidden>
            –
          </span>
          <Input
            type="date"
            value={toDay}
            min={fromDay || undefined}
            onChange={(e) => handleToChange(e.target.value)}
            aria-label="Created to (inclusive)"
            aria-invalid={rangeInverted}
            className="min-h-11 flex-1 sm:w-38 sm:min-h-9 sm:flex-none"
          />
        </div>

        {importBatch ? (
          <Badge variant="secondary" className="min-h-9 gap-1.5 px-3 font-normal">
            Imported from <span className="font-medium">{importBatch.fileName}</span>
            <button
              type="button"
              aria-label="Show all deliveries"
              className="rounded-sm opacity-70 hover:opacity-100"
              onClick={() => {
                setImportBatch(null);
                setPage(1);
              }}
            >
              <X className="size-3.5" />
            </button>
          </Badge>
        ) : null}

        {hasFilters ? (
          <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={clearFilters}>
            <X /> Clear filters
          </Button>
        ) : null}

        <div className="hidden flex-1 sm:block" aria-hidden />

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
            onClick={() => setImportOpen(true)}
            title={importLockedHint}
            aria-description={importLockedHint}
          >
            {importLocked ? <Lock /> : <FileSpreadsheet />} Import
            {importLocked ? <span className="sr-only">(upgrade required)</span> : null}
          </Button>
          <Button className="min-h-11 flex-1 sm:min-h-9 sm:flex-none" onClick={() => setCreateOpen(true)}>
            <Plus /> New delivery
          </Button>
        </div>
      </div>

      {rangeInverted ? (
        <p className="text-sm text-destructive" role="alert">
          The start date is after the end date — the date filter is ignored until it&apos;s fixed.
        </p>
      ) : null}

      {/* Error */}
      {error ? (
        <Card className="border-destructive/40 p-4 text-sm text-destructive" role="alert">
          Couldn&apos;t load deliveries: {error}
        </Card>
      ) : null}

      {/* Loading skeleton */}
      {loading && !data ? (
        <>
          <Card className="hidden gap-3 px-6 py-4 md:block">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </Card>
          <div className="grid gap-4 md:hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        </>
      ) : null}

      {/* Empty state */}
      {isEmpty && hasFilters ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <Package className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">No deliveries match your filters.</p>
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : null}

      {/* First-run empty state: the organization has no deliveries at all */}
      {isEmpty && !hasFilters ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
            <Package className="size-7 text-primary" aria-hidden />
          </div>
          <div className="max-w-md space-y-1">
            <p className="text-base font-semibold">No deliveries yet</p>
            <p className="text-sm text-muted-foreground">
              Add your first order by hand, or bring in today&apos;s orders from a spreadsheet — up to 1,000 at a time.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button className="min-h-11 sm:min-h-9" onClick={() => setCreateOpen(true)}>
              <Plus /> Create delivery
            </Button>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setImportOpen(true)}
              title={importLockedHint}
              aria-description={importLockedHint}
            >
              {importLocked ? <Lock /> : <FileSpreadsheet />} Import from a spreadsheet
              {importLocked ? <span className="sr-only">(upgrade required)</span> : null}
            </Button>
            {/* The template is part of the import feature (the server refuses it without csv_import). */}
            {importLocked ? null : (
              <Button asChild variant="ghost" className="min-h-11 sm:min-h-9">
                <a href={TEMPLATE_URL} download>
                  <Download /> Download template
                </a>
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {/* Desktop table */}
      {showList && data ? (
        <Card className="hidden gap-0 overflow-hidden py-0 md:block">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">Tracking</TableHead>
                  <TableHead className="px-4">Recipient</TableHead>
                  <TableHead className="px-4">Priority</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4">Driver</TableHead>
                  <TableHead className="px-4">Expected</TableHead>
                  <TableHead className="px-4">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody aria-busy={loading}>
                {items.map((d) => (
                  <TableRow
                    key={d.id}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => openDetail(d.id)}
                  >
                    <TableCell className="px-4 py-3">
                      <button
                        type="button"
                        className="font-mono text-sm font-medium hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(d.id);
                        }}
                        aria-label={`Open details for ${d.trackingCode}`}
                      >
                        {d.trackingCode}
                      </button>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="font-medium">{d.recipientName}</div>
                      <div className="max-w-56 truncate text-xs text-muted-foreground">
                        {truncate(d.deliveryAddress, 48)}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <PriorityBadge priority={d.priority} />
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {d.assignment?.driverName ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="px-4 py-3">{friendlyDueDate(d.expectedAt)}</TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{formatDate(d.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {loading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                        <TableCell colSpan={7} className="px-4 py-3">
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
              </TableBody>
            </Table>
          </CardContent>
          <div className="border-t">
            <PaginationBar data={data} loading={loading} onPage={setPage} />
          </div>
        </Card>
      ) : null}

      {/* Mobile cards */}
      {showList && data ? (
        <div className="space-y-3 md:hidden">
          {items.map((d) => (
            <Card
              key={d.id}
              role="button"
              tabIndex={0}
              aria-label={`Open details for ${d.trackingCode}`}
              className="cursor-pointer gap-2 p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openDetail(d.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDetail(d.id);
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium">{d.trackingCode}</span>
                <StatusBadge status={d.status} />
              </div>
              <p className="font-medium">{d.recipientName}</p>
              <p className="text-sm text-muted-foreground">{truncate(d.deliveryAddress, 56)}</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{d.assignment?.driverName ?? "Unassigned"}</span>
                <span>{friendlyDueDate(d.expectedAt)}</span>
              </div>
              <div className="mt-1">
                <PriorityBadge priority={d.priority} />
              </div>
            </Card>
          ))}
          {loading
            ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={`sk-${i}`} className="h-32 w-full rounded-xl" />)
            : null}
          <PaginationBar data={data} loading={loading} onPage={setPage} />
        </div>
      ) : null}

      {/* Detail dialog — keyed by delivery so switching never flashes the previous one */}
      <DeliveryDetailDialog
        key={shownId ?? "none"}
        deliveryId={shownId}
        open={!!focusDeliveryId}
        onOpenChange={handleDetailOpenChange}
      />

      {/* Create dialog */}
      <DeliveryFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Bulk CSV import */}
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onViewImported={showImported} />
    </div>
  );
}

export default DeliveriesView;
