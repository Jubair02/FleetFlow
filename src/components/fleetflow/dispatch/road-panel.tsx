"use client";

import { ExternalLink, MoreHorizontal, Route, Truck, UserX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DispatchDriver } from "@/lib/types";
import { goToDelivery } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/fleetflow/driver/ui";
import { CARD_SURFACE, ENTER_MOTION, splitAddress } from "@/components/fleetflow/driver/job-utils";
import { VehicleTypeLabel } from "@/components/fleetflow/badges";
import { AvailabilityDot, DueText, LoadBar, Squircle, TrackingLink, availabilityLabel, type ActiveAssignment } from "./helpers";

type Group = { driverId: string; driverName: string; driver: DispatchDriver | null; items: ActiveAssignment[] };

export function RoadPanel({
  assignments,
  drivers,
  nowMs,
  driverFilter,
  onClearDriverFilter,
  onUnassign,
}: {
  assignments: ActiveAssignment[];
  drivers: DispatchDriver[];
  nowMs: number;
  driverFilter: string | null;
  onClearDriverFilter: () => void;
  onUnassign: (a: ActiveAssignment) => void;
}) {
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const map = new Map<string, Group>();
  for (const a of assignments) {
    const g = map.get(a.driverId) ?? { driverId: a.driverId, driverName: a.driverName, driver: byId.get(a.driverId) ?? null, items: [] };
    g.items.push(a);
    map.set(a.driverId, g);
  }
  const groups = [...map.values()]
    .filter((g) => !driverFilter || g.driverId === driverFilter)
    .sort((a, b) => a.driverName.localeCompare(b.driverName));
  const filterName = driverFilter ? (byId.get(driverFilter)?.name ?? map.get(driverFilter)?.driverName ?? "driver") : null;

  return (
    <div className="space-y-4">
      {filterName ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Showing</span>
          <button
            type="button"
            onClick={onClearDriverFilter}
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-foreground pr-2 pl-3.5 text-sm font-medium text-background transition-opacity outline-none hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8"
            aria-label={`Clear driver filter: ${filterName}`}
          >
            {filterName}
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className={cn(CARD_SURFACE, ENTER_MOTION, "flex flex-col items-center px-6 py-12 text-center")}>
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground" aria-hidden="true">
            <Route className="size-6" />
          </span>
          <h3 className="mt-4 font-semibold tracking-tight">{filterName ? `${filterName} has no active deliveries` : "Nobody is on the road"}</h3>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {filterName ? "Assign something from the queue to get them moving." : "Assigned deliveries show up here, grouped by driver, until they're delivered or fail."}
          </p>
          {filterName ? (
            <Button variant="outline" className="mt-4 min-h-11 rounded-xl sm:min-h-9" onClick={onClearDriverFilter}>
              Show all drivers
            </Button>
          ) : null}
        </div>
      ) : (
        groups.map((g, gi) => {
          const regs = [...new Map(g.items.map((a) => [a.vehicleRegistration, a])).values()];
          return (
            <section
              key={g.driverId}
              aria-label={`${g.driverName}, ${g.items.length} active`}
              className={cn(CARD_SURFACE, ENTER_MOTION, "overflow-hidden")}
              style={{ animationDelay: `${Math.min(gi, 6) * 40}ms`, animationFillMode: "backwards" }}
            >
              <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 bg-muted/30 px-4 py-3 dark:border-white/10">
                <Squircle name={g.driverName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{g.driverName}</p>
                  {g.driver ? (
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <AvailabilityDot driver={g.driver} />
                      {availabilityLabel(g.driver)}
                    </p>
                  ) : null}
                </div>
                <div className="flex w-full items-center gap-3 sm:w-auto">
                  {regs.map((a) => (
                    <span key={a.vehicleRegistration} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Truck className="size-3.5" aria-hidden="true" />
                      <span className="font-mono font-medium tracking-wide text-foreground">{a.vehicleRegistration}</span>
                      <span className="hidden sm:inline">
                        · <VehicleTypeLabel type={a.vehicleType} />
                      </span>
                    </span>
                  ))}
                  {g.driver ? <LoadBar driver={g.driver} className="ml-auto w-28 sm:ml-0" /> : null}
                </div>
              </header>
              <ul className="divide-y divide-border/60 dark:divide-white/[0.07]">
                {g.items.map((a) => {
                  const { line1, line2 } = splitAddress(a.delivery.deliveryAddress);
                  return (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                      <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-center md:gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <TrackingLink delivery={a.delivery} />
                            <StatusPill status={a.delivery.status} className="h-6 text-[11px]" />
                          </div>
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">{a.delivery.recipientName}</p>
                        </div>
                        <p className="mt-1 min-w-0 text-sm md:mt-0">
                          <span className="block truncate">{line1}</span>
                          {line2 ? <span className="block truncate text-xs text-muted-foreground">{line2}</span> : null}
                        </p>
                        <DueText delivery={a.delivery} nowMs={nowMs} className="mt-1 md:mt-0" />
                      </div>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 shrink-0 rounded-xl md:size-9"
                            aria-label={`More actions for ${a.delivery.trackingCode}`}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem className="min-h-10" onSelect={() => goToDelivery(a.delivery.id)}>
                            <ExternalLink aria-hidden="true" /> Open delivery
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="min-h-10 text-rose-700 focus:text-rose-800 dark:text-rose-400 dark:focus:text-rose-300"
                            onSelect={() => onUnassign(a)}
                          >
                            <UserX aria-hidden="true" className="text-current" /> Unassign…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
