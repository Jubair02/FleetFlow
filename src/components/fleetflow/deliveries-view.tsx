"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Package, Plus, Search } from "lucide-react";

import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { DeliveriesPage, Delivery } from "@/lib/types";
import { DELIVERY_STATUSES, PRIORITIES, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/constants";
import { PriorityBadge, StatusBadge } from "@/components/fleetflow/badges";
import { formatDate, friendlyDueDate, truncate } from "@/lib/format";
import { DeliveryDetailDialog } from "@/components/fleetflow/delivery-detail-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

interface CreateFormState {
  recipientName: string;
  recipientPhone: string;
  pickupAddress: string;
  deliveryAddress: string;
  instructions: string;
  priority: string;
  expectedAtLocal: string;
}

const EMPTY_FORM: CreateFormState = {
  recipientName: "",
  recipientPhone: "",
  pickupAddress: "",
  deliveryAddress: "",
  instructions: "",
  priority: "NORMAL",
  expectedAtLocal: "",
};

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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  // Debounce the search box (350 ms)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change resets pagination
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, priorityFilter]);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (statusFilter !== "ALL") params.set("status", statusFilter);
  if (priorityFilter !== "ALL") params.set("priority", priorityFilter);
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));

  const { data, loading, error } = useApiData<DeliveriesPage>(`/api/deliveries?${params.toString()}`, [page]);

  // If the list shrank and the current page no longer exists, step back.
  useEffect(() => {
    if (data && data.page > data.pageCount) setPage(data.pageCount);
  }, [data]);

  // ── detail dialog ─────────────────────────────────────────
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const focusDeliveryId = useAppStore((s) => s.focusDeliveryId);
  const focusDelivery = useAppStore((s) => s.focusDelivery);

  useEffect(() => {
    if (focusDeliveryId) {
      setDetailId(focusDeliveryId);
      setDetailOpen(true);
    }
  }, [focusDeliveryId]);

  function openDetail(id: string) {
    setDetailId(id);
    setDetailOpen(true);
  }

  function handleDetailOpenChange(o: boolean) {
    setDetailOpen(o);
    if (!o) {
      setDetailId(null);
      focusDelivery(null);
    }
  }

  // ── create dialog ─────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  function handleCreateOpenChange(o: boolean) {
    setCreateOpen(o);
    if (!o) {
      setForm(EMPTY_FORM);
      setFormErrors({});
      setSubmitting(false);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, boolean> = {
      recipientName: !form.recipientName.trim(),
      recipientPhone: !form.recipientPhone.trim(),
      pickupAddress: !form.pickupAddress.trim(),
      deliveryAddress: !form.deliveryAddress.trim(),
    };
    setFormErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toast.error("Please fill in the required fields");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ delivery: Delivery }>("/api/deliveries", {
        recipientName: form.recipientName.trim(),
        recipientPhone: form.recipientPhone.trim(),
        pickupAddress: form.pickupAddress.trim(),
        deliveryAddress: form.deliveryAddress.trim(),
        instructions: form.instructions.trim() || undefined,
        priority: form.priority,
        expectedAt: form.expectedAtLocal ? new Date(form.expectedAtLocal).toISOString() : null,
      });
      toast.success(`Delivery created — tracking code ${res.delivery.trackingCode}`);
      useAppStore.getState().bump();
      handleCreateOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create delivery");
    } finally {
      setSubmitting(false);
    }
  }

  const items = data?.items ?? [];
  const isEmpty = !loading && !error && data && items.length === 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search tracking code, recipient, address…"
            aria-label="Search deliveries"
            className="min-h-11 pl-9 sm:min-h-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
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

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
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

        <div className="hidden flex-1 sm:block" aria-hidden />

        <Button className="min-h-11 sm:min-h-9" onClick={() => handleCreateOpenChange(true)}>
          <Plus /> New delivery
        </Button>
      </div>

      {/* Error */}
      {error ? (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
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
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <Package className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">No deliveries match your filters.</p>
        </div>
      ) : null}

      {/* Desktop table */}
      {data && !isEmpty && !error ? (
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
              <TableBody>
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
                {loading && data
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
          {data ? (
            <div className="border-t">
              <PaginationBar data={data} loading={loading} onPage={setPage} />
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Mobile cards */}
      {data && !isEmpty && !error ? (
        <div className="space-y-3 md:hidden">
          {items.map((d) => (
            <Card
              key={d.id}
              role="button"
              tabIndex={0}
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
          {loading && data
            ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={`sk-${i}`} className="h-32 w-full rounded-xl" />)
            : null}
          {data ? <PaginationBar data={data} loading={loading} onPage={setPage} /> : null}
        </div>
      ) : null}

      {/* Detail dialog */}
      <DeliveryDetailDialog deliveryId={detailId} open={detailOpen} onOpenChange={handleDetailOpenChange} />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>New delivery</DialogTitle>
            <DialogDescription>
              Create a delivery order — it enters the dispatch queue for assignment.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleCreateSubmit} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-recipient-name">
                  Recipient name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="new-recipient-name"
                  value={form.recipientName}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, recipientName: e.target.value }));
                    if (e.target.value.trim()) setFormErrors((er) => ({ ...er, recipientName: false }));
                  }}
                  aria-invalid={!!formErrors.recipientName}
                  placeholder="Jane Doe"
                  className={cn(
                    "min-h-11 sm:min-h-9",
                    formErrors.recipientName && "border-destructive focus-visible:ring-destructive/30",
                  )}
                />
                {formErrors.recipientName ? (
                  <p className="text-xs text-destructive">Recipient name is required.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-recipient-phone">
                  Contact number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="new-recipient-phone"
                  type="tel"
                  value={form.recipientPhone}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, recipientPhone: e.target.value }));
                    if (e.target.value.trim()) setFormErrors((er) => ({ ...er, recipientPhone: false }));
                  }}
                  aria-invalid={!!formErrors.recipientPhone}
                  placeholder="+1 555 010 1234"
                  className={cn(
                    "min-h-11 sm:min-h-9",
                    formErrors.recipientPhone && "border-destructive focus-visible:ring-destructive/30",
                  )}
                />
                {formErrors.recipientPhone ? (
                  <p className="text-xs text-destructive">Contact number is required.</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-pickup">
                Pickup address <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="new-pickup"
                value={form.pickupAddress}
                onChange={(e) => {
                  setForm((f) => ({ ...f, pickupAddress: e.target.value }));
                  if (e.target.value.trim()) setFormErrors((er) => ({ ...er, pickupAddress: false }));
                }}
                aria-invalid={!!formErrors.pickupAddress}
                placeholder="Warehouse 4, 12 Harbor Industrial Park"
                className={cn(
                  "min-h-11 sm:min-h-9",
                  formErrors.pickupAddress && "border-destructive focus-visible:ring-destructive/30",
                )}
              />
              {formErrors.pickupAddress ? (
                <p className="text-xs text-destructive">Pickup address is required.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-delivery-address">
                Delivery address <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="new-delivery-address"
                value={form.deliveryAddress}
                onChange={(e) => {
                  setForm((f) => ({ ...f, deliveryAddress: e.target.value }));
                  if (e.target.value.trim()) setFormErrors((er) => ({ ...er, deliveryAddress: false }));
                }}
                aria-invalid={!!formErrors.deliveryAddress}
                placeholder="88 Maple Street, Apt 3B, Springfield"
                className={cn(
                  formErrors.deliveryAddress && "border-destructive focus-visible:ring-destructive/30",
                )}
              />
              {formErrors.deliveryAddress ? (
                <p className="text-xs text-destructive">Delivery address is required.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-instructions">Delivery instructions (optional)</Label>
              <Textarea
                id="new-instructions"
                value={form.instructions}
                onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                placeholder="Leave at the front desk, call on arrival…"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-priority">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}
                >
                  <SelectTrigger id="new-priority" className="min-h-11 w-full sm:min-h-9">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-expected">Expected delivery (optional)</Label>
                <Input
                  id="new-expected"
                  type="datetime-local"
                  value={form.expectedAtLocal}
                  onChange={(e) => setForm((f) => ({ ...f, expectedAtLocal: e.target.value }))}
                  className="min-h-11 sm:min-h-9"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={submitting}
                onClick={() => handleCreateOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11 sm:min-h-9" disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
                Create delivery
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DeliveriesView;
