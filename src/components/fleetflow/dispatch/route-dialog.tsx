"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Map as MapIcon, MapPinOff, RotateCcw, Route, Save, Sparkles } from "lucide-react";
import { apiFetch, useApiData } from "@/lib/api-client";
import { formatDateTime, formatTime, timeAgo } from "@/lib/format";
import { computeEtas } from "@/lib/route-optimizer";
import type { RoutePlan, RouteStartSource, RouteStop } from "@/lib/route-types";
import { cn } from "@/lib/utils";
import { goToDelivery, useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradeExplainer, isPlanRefusal, useOrgPlanInfo } from "@/components/fleetflow/plan-panel";
import { PriorityMarker, SheetBody, SheetDialogContent, SheetFooter, SheetHeader, StatusPill } from "@/components/fleetflow/driver/ui";
import { splitAddress } from "@/components/fleetflow/driver/job-utils";

// ─────────────────────────────────────────────────────────────
// Route planner for one driver (dispatch board → "Route"): the open
// stops in order with arrival estimates, "Optimise route", and manual
// reordering. Needs the live_map plan feature (server-enforced).
// Estimates only — see docs/ROUTES.md.
// ─────────────────────────────────────────────────────────────

const START_LABELS: Record<RouteStartSource, string> = {
  DRIVER: "from the driver's current location",
  DEPOT: "from your depot",
  FIRST_STOP: "from the first stop (set your depot on the map for better estimates)",
};

export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export function RouteDialog({
  driver,
  open,
  onOpenChange,
}: {
  /** Kept while the dialog animates closed. */
  driver: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { planInfo, locked } = useOrgPlanInfo();
  const isLocked = locked("live_map");
  const url = open && driver && !isLocked ? `/api/routes?driverId=${encodeURIComponent(driver.id)}` : null;
  const { data, loading, error, reload } = useApiData<RoutePlan>(url);
  const plan = data && driver && data.driver.id === driver.id ? data : null;

  // Draft order (null = the saved order). Keyed by plan so a refresh resets it.
  const [draft, setDraft] = useState<{ planKey: string; order: string[] } | null>(null);
  const [busy, setBusy] = useState<"optimize" | "save" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const savedOrder = plan?.stops.map((s) => s.id) ?? [];
  const planKey = plan ? `${plan.driver.id}:${plan.plannedAt ?? ""}:${savedOrder.join(",")}` : "";
  const order = draft && draft.planKey === planKey ? draft.order : savedOrder;
  const dirty = !!plan && !sameOrder(order, savedOrder);
  const byId = new Map((plan?.stops ?? []).map((s) => [s.id, s]));
  const stops = order.map((id) => byId.get(id)).filter((s): s is RouteStop => !!s);

  // While reordering, preview estimates for the draft order from the same start point.
  const preview = dirty && plan ? computeEtas(plan.start, stops, new Date()) : null;
  const totals = preview ? { km: Math.round(preview.totalKm * 10) / 10, minutes: Math.round(preview.totalMinutes) } : plan?.totals;
  const unlocated = stops.filter((s) => s.lat == null || s.lng == null);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ planKey, order: next });
  }

  async function submit(kind: "optimize" | "save") {
    if (!driver) return;
    setBusy(kind);
    setRefusal(null);
    try {
      if (kind === "optimize") {
        await apiFetch<RoutePlan>("/api/routes/optimize", { method: "POST", body: JSON.stringify({ driverId: driver.id }) });
        toast.success(`${driver.name}'s route optimised`);
      } else {
        await apiFetch<RoutePlan>("/api/routes", { method: "PUT", body: JSON.stringify({ driverId: driver.id, order }) });
        toast.success("Stop order saved");
      }
      setDraft(null);
      useAppStore.getState().bump(["/api/routes", "/api/dispatch", "/api/deliveries"]);
    } catch (e) {
      if (isPlanRefusal(e)) setRefusal(e.message);
      else toast.error(e instanceof Error ? e.message : "Couldn't save the route");
      if (!isPlanRefusal(e)) void reload();
    } finally {
      setBusy(null);
    }
  }

  const showUpgrade = isLocked || !!refusal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetDialogContent className="sm:max-w-2xl" closeDisabled={!!busy}>
        <SheetHeader
          title={driver ? `${driver.name}'s route` : "Route"}
          description={
            showUpgrade
              ? "Plan stop order and arrival estimates."
              : plan && totals
                ? `${plan.stops.length} ${plan.stops.length === 1 ? "stop" : "stops"} · about ${totals.km} km · ${formatMinutes(totals.minutes)}${plan.start ? ` ${START_LABELS[plan.start.source]}` : ""}`
                : "Open stops in order, with estimated arrival times."
          }
        />
        <SheetBody className="space-y-4">
          {showUpgrade ? (
            <UpgradeExplainer feature="live_map" planName={planInfo?.name ?? null} message={refusal} />
          ) : loading && !plan ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading the route">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : error && !plan ? (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
              <p>{error}</p>
              <Button variant="outline" size="sm" className="mt-2 min-h-11 rounded-xl sm:min-h-9" onClick={() => void reload()}>
                <RotateCcw aria-hidden="true" /> Retry
              </Button>
            </div>
          ) : plan && stops.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground" aria-hidden="true">
                <Route className="size-5" />
              </span>
              <p className="mt-3 font-medium">No open stops</p>
              <p className="mt-1 text-sm text-muted-foreground">Assign deliveries to {driver?.name ?? "this driver"} to plan a route.</p>
            </div>
          ) : plan ? (
            <>
              <p className="text-xs text-muted-foreground">
                {dirty
                  ? "Unsaved order — times below are a preview. Save to update the estimates drivers and customers see."
                  : plan.plannedAt
                    ? `Planned ${timeAgo(plan.plannedAt)} (${formatDateTime(plan.plannedAt)}). Arrival times are estimates.`
                    : "Not planned yet — optimise the route or reorder the stops and save. Arrival times are estimates."}
              </p>

              {unlocated.length > 0 ? (
                <div
                  role="status"
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <p className="flex items-center gap-2 font-medium">
                    <MapPinOff className="size-4 shrink-0" aria-hidden="true" />
                    {unlocated.length === 1 ? "1 stop has" : `${unlocated.length} stops have`} no map location
                  </p>
                  <p className="mt-1 text-amber-800 dark:text-amber-300">They go last and get no arrival estimate until they are placed on the map.</p>
                  <ul className="mt-2 space-y-1">
                    {unlocated.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-2">
                        <span className="font-mono text-xs">{s.trackingCode}</span>
                        <span className="min-w-0 truncate">{splitAddress(s.deliveryAddress).line1}</span>
                        <button
                          type="button"
                          className="ml-auto inline-flex min-h-11 items-center font-medium underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
                          onClick={() => {
                            onOpenChange(false);
                            goToDelivery(s.id);
                          }}
                        >
                          Locate on map<span className="sr-only"> for {s.trackingCode}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 dark:divide-white/[0.07] dark:border-white/10" aria-label="Stops in order">
                {stops.map((s, i) => {
                  const eta = preview ? (preview.stops[i].eta?.toISOString() ?? null) : s.plannedEta;
                  const { line1, line2 } = splitAddress(s.deliveryAddress);
                  return (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold tabular-nums text-primary"
                        aria-label={`Stop ${i + 1}`}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs tracking-wide text-muted-foreground">{s.trackingCode}</span>
                          <PriorityMarker priority={s.priority} className="h-5 px-2 text-[11px]" />
                          <StatusPill status={s.status} className="h-5 px-2 text-[11px]" />
                        </div>
                        <p className="mt-0.5 truncate text-sm font-medium">{line1}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.recipientName}
                          {line2 ? ` · ${line2}` : ""}
                        </p>
                      </div>
                      <div className="w-20 shrink-0 text-right text-xs">
                        {s.lat == null || s.lng == null ? (
                          <span className="text-amber-700 dark:text-amber-300">No location</span>
                        ) : eta ? (
                          <>
                            <span className="block text-muted-foreground">ETA</span>
                            <span className={cn("block text-sm font-semibold tabular-nums", preview && "text-muted-foreground")}>{formatTime(eta)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Not planned</span>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-11 rounded-lg sm:size-8"
                          disabled={i === 0 || !!busy}
                          onClick={() => move(i, -1)}
                          aria-label={`Move ${s.trackingCode} up`}
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-11 rounded-lg sm:size-8"
                          disabled={i === stops.length - 1 || !!busy}
                          onClick={() => move(i, 1)}
                          aria-label={`Move ${s.trackingCode} down`}
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
        </SheetBody>
        {!showUpgrade && plan && stops.length > 0 ? (
          <SheetFooter>
            {/* the saved order drawn on the map (src/components/fleetflow/map/live-map-view.tsx) */}
            <Button type="button" variant="ghost" className="min-h-11 rounded-xl sm:min-h-9" onClick={() => useAppStore.getState().setView("map")}>
              <MapIcon aria-hidden="true" /> Live map
            </Button>
            {dirty ? (
              <Button type="button" variant="outline" className="min-h-11 rounded-xl sm:min-h-9" disabled={!!busy} onClick={() => setDraft(null)}>
                <RotateCcw aria-hidden="true" /> Reset
              </Button>
            ) : null}
            <Button
              type="button"
              variant={dirty ? "outline" : "default"}
              className="min-h-11 rounded-xl sm:min-h-9"
              disabled={!!busy}
              onClick={() => void submit("optimize")}
            >
              {busy === "optimize" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />} Optimise route
            </Button>
            {dirty ? (
              <Button type="button" className="min-h-11 rounded-xl sm:min-h-9" disabled={!!busy} onClick={() => void submit("save")}>
                {busy === "save" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />} Save order
              </Button>
            ) : null}
          </SheetFooter>
        ) : null}
      </SheetDialogContent>
    </Dialog>
  );
}
