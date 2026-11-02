"use client";

import { useMemo, useState } from "react";
import { MapPinned, RefreshCw, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiData } from "@/lib/api-client";
import { STATUS_LABELS, type DeliveryStatus } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import type { LiveMapData, MapDelivery, MapDriver } from "@/lib/map-types";
import { cn } from "@/lib/utils";
import { goToDelivery, goToSettings } from "@/store/app-store";
import { UpgradeExplainer, useOrgPlanInfo } from "@/components/fleetflow/plan-panel";
import { DEPOT_COLOR, DRIVER_COLOR, STATUS_PIN_COLORS } from "./map-style";
import { MapView, type MapMarker } from "./map-view";
import { useMapConfig } from "./use-map-config";

// ─────────────────────────────────────────────────────────────
// Live Map (/map, admins & dispatchers; plan feature live_map).
// Drivers sharing a fresh position, open deliveries coloured by status and
// the depot. Pick a driver to see their stops joined in route order
// (routeSeq, set by route planning). Refreshes every 30 s.
// ─────────────────────────────────────────────────────────────

const REFRESH_MS = 30_000;
const ALL = "all";
const UNASSIGNED = "unassigned";

const statusLabel = (s: string) => STATUS_LABELS[s as DeliveryStatus] ?? s;

/** A driver's route: their position, then their stops by routeSeq (unplanned stops last). */
export function driverRoute(driver: MapDriver | null, stops: MapDelivery[]): LatLng[] {
  const ordered = stops
    .slice()
    .sort((a, b) => (a.routeSeq ?? Number.MAX_SAFE_INTEGER) - (b.routeSeq ?? Number.MAX_SAFE_INTEGER) || a.trackingCode.localeCompare(b.trackingCode));
  return [...(driver ? [{ lat: driver.lat, lng: driver.lng }] : []), ...ordered.map((d) => ({ lat: d.lat, lng: d.lng }))];
}

export function LiveMapView() {
  const { planInfo, locked } = useOrgPlanInfo();
  const noPlan = locked("live_map");
  const map = useApiData<LiveMapData>(noPlan ? null : "/api/map", { refreshInterval: REFRESH_MS, revalidateOnFocus: true });
  const config = useMapConfig();
  const [driverFilter, setDriverFilter] = useState<string>(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = map.data;
  const refused = noPlan || (!!map.error && /isn.t included in your/i.test(map.error));

  const visibleDeliveries = useMemo(() => {
    const all = data?.deliveries ?? [];
    if (driverFilter === ALL) return all;
    if (driverFilter === UNASSIGNED) return all.filter((d) => !d.driverId);
    return all.filter((d) => d.driverId === driverFilter);
  }, [data, driverFilter]);

  const selectedDriver = data?.drivers.find((d) => d.id === driverFilter) ?? null;
  const routeLine = useMemo(
    () => (driverFilter !== ALL && driverFilter !== UNASSIGNED ? driverRoute(selectedDriver, visibleDeliveries) : null),
    [driverFilter, selectedDriver, visibleDeliveries]
  );

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const out: MapMarker[] = [];
    if (data.depot) out.push({ id: "depot", kind: "depot", lat: data.depot.lat, lng: data.depot.lng, color: DEPOT_COLOR, title: `Depot${data.depot.address ? ` — ${data.depot.address}` : ""}` });
    for (const d of visibleDeliveries) {
      out.push({
        id: `d:${d.id}`,
        kind: "delivery",
        lat: d.lat,
        lng: d.lng,
        color: STATUS_PIN_COLORS[d.status] ?? "#64748b",
        label: routeLine && d.routeSeq != null ? String(d.routeSeq) : undefined,
        title: `${d.trackingCode} · ${d.recipientName} · ${statusLabel(d.status)}`,
        selected: selectedId === `d:${d.id}`,
        clickable: true,
      });
    }
    for (const dr of data.drivers) {
      if (driverFilter !== ALL && driverFilter !== dr.id) continue;
      out.push({
        id: `r:${dr.id}`,
        kind: "driver",
        lat: dr.lat,
        lng: dr.lng,
        color: DRIVER_COLOR,
        label: dr.name.split(/\s+/).map((w) => w[0]).join(""),
        title: `${dr.name}${dr.vehicle ? ` · ${dr.vehicle}` : ""} · updated ${timeAgo(dr.recordedAt)}`,
        selected: selectedId === `r:${dr.id}`,
        clickable: true,
      });
    }
    return out;
  }, [data, visibleDeliveries, driverFilter, selectedId, routeLine]);

  const onMarkerClick = (id: string) => {
    if (id.startsWith("d:")) goToDelivery(id.slice(2));
    else if (id.startsWith("r:")) {
      setDriverFilter(id.slice(2));
      setSelectedId(id);
    }
  };

  if (refused) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Live Map</h1>
        <UpgradeExplainer feature="live_map" planName={planInfo?.name} />
        <Button variant="outline" onClick={() => goToSettings("plan")}>See plans</Button>
      </div>
    );
  }

  const driversById = new Map((data?.drivers ?? []).map((d) => [d.id, d]));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto flex items-center gap-2 text-xl font-semibold tracking-tight">
          <MapPinned className="size-5 text-primary" aria-hidden /> Live Map
        </h1>
        <Select value={driverFilter} onValueChange={(v) => { setDriverFilter(v); setSelectedId(null); }}>
          <SelectTrigger className="min-h-11 w-full sm:min-h-9 sm:w-56" aria-label="Filter by driver">
            <SelectValue placeholder="All drivers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All drivers &amp; deliveries</SelectItem>
            <SelectItem value={UNASSIGNED}>Unassigned deliveries</SelectItem>
            {(data?.drivers ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="size-11 sm:size-9" onClick={map.reload} aria-label="Refresh map" disabled={map.loading}>
          <RefreshCw className={cn(map.loading && "animate-spin")} aria-hidden />
        </Button>
      </div>

      {map.error && !data ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {map.error} <Button variant="link" className="h-auto p-0" onClick={map.reload}>Retry</Button>
        </div>
      ) : null}

      {data && data.missingLocation > 0 ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {data.missingLocation} of {data.openTotal} open {data.openTotal === 1 ? "delivery isn't" : "deliveries aren't"} on the map yet —{" "}
          {data.geocoding ? "addresses are looked up automatically, or" : ""} drop a pin when editing the delivery.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {data || config ? (
          <MapView
            styleUrl={config?.styleUrl}
            className="h-[55vh] min-h-80 lg:h-[calc(100vh-14rem)]"
            markers={markers}
            line={routeLine}
            fitKey={`${driverFilter}:${data ? "ready" : "loading"}`}
            onMarkerClick={onMarkerClick}
            ariaLabel="Live map of drivers and deliveries"
          />
        ) : (
          <Skeleton className="h-[55vh] min-h-80 rounded-lg" />
        )}

        <aside className="flex max-h-[calc(100vh-14rem)] flex-col gap-4 overflow-y-auto" aria-label="Drivers and stops">
          <section>
            <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
              Drivers on the road <Badge variant="secondary">{data?.drivers.length ?? 0}</Badge>
            </h2>
            {!data ? (
              <Skeleton className="h-16 w-full" />
            ) : data.drivers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No driver is sharing a location. Drivers share it automatically while a delivery is picked up or in transit.
              </p>
            ) : (
              <ul className="space-y-1">
                {data.drivers.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => { setDriverFilter(d.id === driverFilter ? ALL : d.id); setSelectedId(`r:${d.id}`); }}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent", driverFilter === d.id && "bg-accent")}
                      aria-pressed={driverFilter === d.id}
                    >
                      <Truck className="size-4 shrink-0" style={{ color: DRIVER_COLOR }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{d.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {d.vehicle ? `${d.vehicle} · ` : ""}{d.jobs} {d.jobs === 1 ? "job" : "jobs"} · {timeAgo(d.recordedAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
              {routeLine ? "Stops in route order" : "Open deliveries on the map"} <Badge variant="secondary">{visibleDeliveries.length}</Badge>
            </h2>
            {!data ? (
              <Skeleton className="h-32 w-full" />
            ) : visibleDeliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to show for this filter.</p>
            ) : (
              <ul className="space-y-1">
                {(routeLine
                  ? visibleDeliveries.slice().sort((a, b) => (a.routeSeq ?? 1e9) - (b.routeSeq ?? 1e9))
                  : visibleDeliveries
                ).slice(0, 200).map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => goToDelivery(d.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                    >
                      <span className="size-3 shrink-0 rounded-full ring-2 ring-background" style={{ background: STATUS_PIN_COLORS[d.status] ?? "#64748b" }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {routeLine && d.routeSeq != null ? `${d.routeSeq}. ` : ""}{d.trackingCode} · {d.recipientName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {statusLabel(d.status)}
                          {d.driverId && driversById.has(d.driverId) ? ` · ${driversById.get(d.driverId)!.name}` : ""} · {d.deliveryAddress}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {data?.capped ? <p className="mt-2 text-xs text-muted-foreground">Showing the oldest 1,000 open deliveries.</p> : null}
          </section>

          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
            {(["CREATED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "FAILED"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-full" style={{ background: STATUS_PIN_COLORS[s] }} aria-hidden /> {statusLabel(s)}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-sm" style={{ background: DEPOT_COLOR }} aria-hidden /> Depot
            </span>
          </p>
        </aside>
      </div>
    </div>
  );
}

export default LiveMapView;
