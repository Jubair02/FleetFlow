"use client";

import { ChevronRight, Truck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DispatchDriver, DispatchVehicle } from "@/lib/types";
import { VehicleTypeLabel } from "@/components/fleetflow/badges";
import { AvailabilityDot, LoadBar, Squircle, availabilityLabel, byDriverRank, isDriverFree } from "./helpers";

function vehicleState(v: DispatchVehicle): { label: string; tone: "free" | "busy" | "off" } {
  if (v.status === "MAINTENANCE") return { label: "Maintenance", tone: "off" };
  if (v.status === "INACTIVE") return { label: "Inactive", tone: "off" };
  if (v.currentDriverName) return { label: `In use by ${v.currentDriverName}`, tone: "busy" };
  return { label: "Free", tone: "free" };
}

/** Driver list + vehicle list. Used in the sticky rail (≥lg) and the Fleet sheet (<lg). */
export function FleetPanel({
  drivers,
  vehicles,
  selectedDriverId,
  onSelectDriver,
}: {
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
  selectedDriverId: string | null;
  onSelectDriver: (id: string) => void;
}) {
  const sorted = [...drivers].sort(byDriverRank);
  const free = drivers.filter(isDriverFree).length;
  const vehicleOf = new Map<string, string>();
  for (const v of vehicles) if (v.currentDriverId && !vehicleOf.has(v.currentDriverId)) vehicleOf.set(v.currentDriverId, v.registrationNumber);
  const freeVehicles = vehicles.filter((v) => v.status === "ACTIVE" && !v.currentDriverId).length;

  return (
    <div className="space-y-6">
      <section aria-labelledby="fleet-drivers-heading">
        <div className="flex items-baseline gap-2 px-1 pb-2">
          <h3 id="fleet-drivers-heading" className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-primary" aria-hidden="true" /> Drivers
          </h3>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {free} of {drivers.length} can take jobs
          </span>
        </div>
        {sorted.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-3 py-4 text-sm text-muted-foreground">No drivers yet.</p>
        ) : (
          <ul className="space-y-1">
            {sorted.map((d) => {
              const reg = vehicleOf.get(d.id);
              const selected = selectedDriverId === d.id;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onSelectDriver(d.id)}
                    aria-pressed={selected}
                    aria-label={`${d.name}, ${availabilityLabel(d)}, ${d.activeJobs} of ${d.maxActiveJobs} active jobs. Show their deliveries on the road`}
                    className={cn(
                      "group flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-150 outline-none",
                      "hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected && "bg-primary/[0.07] ring-1 ring-primary/30 ring-inset hover:bg-primary/10",
                      !d.active && "opacity-70",
                    )}
                  >
                    <Squircle name={d.name} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{d.name}</span>
                        {reg ? (
                          <span className="ml-auto shrink-0 font-mono text-[11px] font-medium tracking-wide text-muted-foreground">{reg}</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <AvailabilityDot driver={d} />
                        {availabilityLabel(d)}
                      </span>
                      <LoadBar driver={d} className="mt-1.5" />
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="fleet-vehicles-heading">
        <div className="flex items-baseline gap-2 px-1 pb-2">
          <h3 id="fleet-vehicles-heading" className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="size-4 text-primary" aria-hidden="true" /> Vehicles
          </h3>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {freeVehicles} of {vehicles.length} free
          </span>
        </div>
        {vehicles.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-3 py-4 text-sm text-muted-foreground">No vehicles yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 dark:divide-white/10">
            {vehicles.map((v) => {
              const s = vehicleState(v);
              return (
                <li key={v.id} className={cn("flex items-center gap-3 px-1 py-2.5", s.tone === "off" && "opacity-70")}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[13px] font-semibold tracking-wide">{v.registrationNumber}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <VehicleTypeLabel type={v.type} />
                      {v.capacity ? ` · ${v.capacity}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "inline-flex max-w-[55%] shrink-0 items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium",
                      s.tone === "free" && "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
                      s.tone === "busy" && "bg-muted text-foreground",
                      s.tone === "off" && "bg-muted text-muted-foreground",
                    )}
                    title={s.label}
                  >
                    <span className="truncate">{s.label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
