"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RotateCcw, Users, UserX } from "lucide-react";

import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { Delivery, DispatchData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AssignDialog } from "@/components/fleetflow/assign-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SheetBody, SheetDialogContent, SheetHeader } from "@/components/fleetflow/driver/ui";
import { CARD_SURFACE } from "@/components/fleetflow/driver/job-utils";
import { DispatchHero, liveLabel } from "@/components/fleetflow/dispatch/hero";
import { BulkBar, QueuePanel } from "@/components/fleetflow/dispatch/queue-panel";
import { RoadPanel } from "@/components/fleetflow/dispatch/road-panel";
import { FleetPanel } from "@/components/fleetflow/dispatch/fleet-rail";
import { BulkAssignDialog } from "@/components/fleetflow/dispatch/bulk-assign-dialog";
import { isDriverFree, type ActiveAssignment } from "@/components/fleetflow/dispatch/helpers";

type Tab = "queue" | "road";

const POLL_MS = 30_000;

function DispatchSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-5" aria-busy="true" aria-label="Loading the dispatch board">
      <Skeleton className="h-[13.5rem] w-full rounded-3xl sm:h-48 lg:h-44" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Skeleton className="h-11 w-64 rounded-xl" />
          <div className="flex gap-2">
            <Skeleton className="h-10 flex-1 rounded-xl" />
            <Skeleton className="hidden h-10 w-40 rounded-xl sm:block" />
          </div>
          <div className={cn(CARD_SURFACE, "divide-y divide-border/60 overflow-hidden dark:divide-white/10")}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="size-5 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <Skeleton className="hidden h-3.5 w-48 md:block" />
                <Skeleton className="hidden h-9 w-20 rounded-xl md:block" />
              </div>
            ))}
          </div>
        </div>
        <div className={cn(CARD_SURFACE, "hidden space-y-3 p-4 lg:block")}>
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DispatchView() {
  const { data, loading, error, reload } = useApiData<DispatchData>("/api/dispatch");

  // Target is kept while the dialog animates closed; `assignOpen` drives visibility.
  const [assignTarget, setAssignTarget] = useState<Delivery | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassignTarget, setUnassignTarget] = useState<ActiveAssignment | null>(null);
  const [unassignReason, setUnassignReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<Tab>("queue");
  const [driverFilter, setDriverFilter] = useState<string | null>(null);
  const [fleetOpen, setFleetOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkTargets, setBulkTargets] = useState<Delivery[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);

  // ── Live refresh ────────────────────────────────────────────
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- stamp each successful load
    if (data) setUpdatedAt(Date.now());
  }, [data]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 15_000);
    const poll = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, POLL_MS);
    const onVisible = () => {
      if (document.hidden) return;
      setNowMs(Date.now());
      void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  function refreshNow() {
    setNowMs(Date.now());
    void reload();
  }

  const unassigned = data?.unassigned ?? [];
  const assignments = data?.assignments ?? [];
  const drivers = data?.drivers ?? [];
  const vehicles = data?.vehicles ?? [];

  // Selection only counts deliveries still in the queue.
  const queueIds = new Set(unassigned.map((d) => d.id));
  const effectiveSelected = new Set([...selected].filter((id) => queueIds.has(id)));

  async function handleUnassign() {
    if (!unassignTarget) return;
    const deliveryId = unassignTarget.delivery.id;
    const reason = unassignReason.trim();
    setBusy(true);
    try {
      await api.post(`/api/deliveries/${deliveryId}/unassign`, reason ? { reason } : {});
      toast.success("Driver unassigned — delivery returned to the queue");
      useAppStore.getState().bump();
      setUnassignTarget(null);
      setUnassignReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unassign");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <DispatchSkeleton />;

  if (error && !data) {
    return (
      <div className="mx-auto max-w-7xl">
        <div role="alert" className={cn(CARD_SURFACE, "flex flex-col items-center px-6 py-12 text-center")}>
          <span className="flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400" aria-hidden="true">
            <AlertTriangle className="size-6" />
          </span>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">Couldn&apos;t load the dispatch board</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-5 min-h-11 rounded-xl sm:min-h-10" onClick={() => void reload()}>
            <RotateCcw /> Retry
          </Button>
        </div>
      </div>
    );
  }

  function openAssign(d: Delivery) {
    setAssignTarget(d);
    setAssignOpen(true);
  }

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set([...prev].filter((x) => queueIds.has(x)));
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleMany(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set([...prev].filter((x) => queueIds.has(x)));
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function openBulk() {
    setBulkTargets(unassigned.filter((d) => effectiveSelected.has(d.id)));
    setBulkOpen(true);
  }

  function selectDriver(id: string) {
    setDriverFilter((cur) => (cur === id ? null : id));
    setTab("road");
    setFleetOpen(false);
  }

  const waiting = unassigned.filter((d) => d.status === "CREATED").length;
  const failed = unassigned.filter((d) => d.status === "FAILED").length;
  const driversFree = drivers.filter(isDriverFree).length;
  const driversActive = drivers.filter((d) => d.active).length;
  const bulkVisible = tab === "queue" && effectiveSelected.size > 0;

  const fleet = (
    <FleetPanel drivers={drivers} vehicles={vehicles} selectedDriverId={tab === "road" ? driverFilter : null} onSelectDriver={selectDriver} />
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <DispatchHero
        waiting={waiting}
        failed={failed}
        onRoad={assignments.length}
        driversFree={driversFree}
        driversActive={driversActive}
        live={liveLabel(updatedAt, nowMs)}
        refreshing={loading}
        onRefresh={refreshNow}
      />

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 sm:flex-row sm:items-center dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <span className="flex min-w-0 flex-1 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold">Couldn&apos;t refresh — showing the last loaded data.</span>{" "}
              <span className="break-words">{error}</span>
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0 rounded-xl border-rose-300 bg-white text-rose-900 hover:bg-rose-100 sm:min-h-9 dark:border-rose-800 dark:bg-transparent dark:text-rose-100 dark:hover:bg-rose-900/40"
            disabled={loading}
            onClick={() => void reload()}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={cn("min-w-0 lg:col-span-2", bulkVisible && "max-md:pb-24")}>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <TabsList className="h-11 w-full rounded-xl bg-muted/70 p-1 sm:w-fit dark:bg-white/5">
                <TabsTrigger value="queue" className="rounded-lg px-4 text-sm data-[state=active]:shadow-sm">
                  Queue <span className="tabular-nums text-muted-foreground">({unassigned.length})</span>
                </TabsTrigger>
                <TabsTrigger value="road" className="rounded-lg px-4 text-sm data-[state=active]:shadow-sm">
                  On the road <span className="tabular-nums text-muted-foreground">({assignments.length})</span>
                </TabsTrigger>
              </TabsList>
              <Button
                variant="outline"
                className="h-11 w-full rounded-xl bg-card sm:ml-auto sm:w-auto lg:hidden dark:bg-input/30"
                onClick={() => setFleetOpen(true)}
              >
                <Users aria-hidden="true" />
                Fleet ·{" "}
                <span className="tabular-nums">
                  {driversFree} can take jobs
                </span>
              </Button>
            </div>

            <TabsContent value="queue" forceMount className="data-[state=inactive]:hidden">
              <QueuePanel
                queue={unassigned}
                nowMs={nowMs}
                selected={effectiveSelected}
                onToggle={toggle}
                onToggleMany={toggleMany}
                onAssign={openAssign}
              />
            </TabsContent>
            <TabsContent value="road" forceMount className="data-[state=inactive]:hidden">
              <RoadPanel
                assignments={assignments}
                drivers={drivers}
                nowMs={nowMs}
                driverFilter={driverFilter}
                onClearDriverFilter={() => setDriverFilter(null)}
                onUnassign={(a) => {
                  setUnassignTarget(a);
                  setUnassignReason("");
                }}
              />
            </TabsContent>
          </Tabs>

          {bulkVisible ? <BulkBar count={effectiveSelected.size} onAssign={openBulk} onClear={() => setSelected(new Set())} /> : null}
        </div>

        <aside aria-label="Fleet" className="hidden lg:block">
          <div className={cn(CARD_SURFACE, "sticky top-[4.5rem] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain p-4")}>
            <h2 className="px-1 pb-3 text-base font-semibold tracking-tight">Fleet</h2>
            {fleet}
          </div>
        </aside>
      </div>

      {/* Fleet sheet (<lg) */}
      <Dialog open={fleetOpen} onOpenChange={setFleetOpen}>
        <SheetDialogContent className="sm:max-w-lg">
          <SheetHeader title="Fleet" description="Tap a driver to see their deliveries on the road." />
          <SheetBody>{fleet}</SheetBody>
        </SheetDialogContent>
      </Dialog>

      {/* Assign dialog (opened from queue rows) */}
      <AssignDialog delivery={assignTarget} open={assignOpen} onOpenChange={setAssignOpen} />

      <BulkAssignDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        deliveries={bulkTargets}
        drivers={drivers}
        vehicles={vehicles}
        onFinished={(failedIds) => setSelected(new Set(failedIds))}
      />

      {/* Unassign dialog */}
      <AlertDialog
        open={!!unassignTarget}
        onOpenChange={(o) => {
          if (!o) {
            setUnassignTarget(null);
            setUnassignReason("");
          }
        }}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign driver?</AlertDialogTitle>
            <AlertDialogDescription>
              {unassignTarget
                ? `${unassignTarget.driverName} will be released from ${unassignTarget.delivery.trackingCode} and the delivery returns to the dispatch queue.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dispatch-unassign-reason">Reason (optional)</Label>
            <Input
              id="dispatch-unassign-reason"
              value={unassignReason}
              onChange={(e) => setUnassignReason(e.target.value)}
              maxLength={300}
              placeholder="e.g. Vehicle breakdown, driver shift ended"
              className="min-h-11 rounded-xl sm:min-h-9"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 rounded-xl sm:min-h-9">Keep assignment</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 rounded-xl sm:min-h-9"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void handleUnassign();
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <UserX />} Unassign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DispatchView;
