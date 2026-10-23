"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DispatchDriver, DispatchVehicle } from "@/lib/types";
import { VehicleTypeLabel } from "@/components/fleetflow/badges";
import {
  AvailabilityDot,
  LoadBar,
  Squircle,
  availabilityLabel,
  byDriverRank,
  driverDisabled,
  driverHint,
  remainingSlots,
  vehicleDisabled,
  vehicleHint,
} from "./helpers";

/**
 * Selectable cards built on native radios: arrow keys move between options,
 * disabled options are skipped, and the group is announced as a radio group.
 */
const CHOICE =
  "group/choice relative flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-card p-3 text-left transition-[border-color,background-color,box-shadow] duration-150 " +
  "hover:border-primary/40 hover:bg-primary/[0.03] " +
  "has-checked:border-primary has-checked:bg-primary/[0.06] has-checked:shadow-[0_0_0_1px_var(--color-primary)] " +
  "has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 " +
  "has-disabled:cursor-not-allowed has-disabled:bg-muted/30 has-disabled:hover:border-border/80 dark:border-white/10 dark:has-checked:border-primary";

function CheckMark() {
  return (
    <span
      className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-transparent transition-colors group-has-[:checked]/choice:border-primary group-has-[:checked]/choice:bg-primary group-has-[:checked]/choice:text-primary-foreground"
      aria-hidden="true"
    >
      <Check className="size-3.5" strokeWidth={3} />
    </span>
  );
}

export function DriverChoices({
  drivers,
  value,
  onChange,
  disabled,
  label = "Driver",
}: {
  drivers: DispatchDriver[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const name = useId();
  const sorted = [...drivers].sort(byDriverRank);
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      {sorted.length === 0 ? (
        <p className="rounded-xl bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">No drivers yet. Add drivers on the Drivers page.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {sorted.map((d) => {
            const off = driverDisabled(d);
            const hint = driverHint(d);
            const left = remainingSlots(d);
            return (
              <label key={d.id} className={CHOICE}>
                <input
                  type="radio"
                  name={name}
                  value={d.id}
                  checked={value === d.id}
                  disabled={off}
                  onChange={() => onChange(d.id)}
                  className="sr-only"
                />
                <Squircle name={d.name} className={cn(off && "opacity-60")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-medium", off && "text-muted-foreground")}>{d.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AvailabilityDot driver={d} />
                    {availabilityLabel(d)}
                    <span aria-hidden="true">·</span>
                    {hint && hint !== "Off duty" && hint !== "Inactive" ? (
                      <span className="font-medium text-foreground">{hint}</span>
                    ) : (
                      <span className="tabular-nums">
                        {left} slot{left === 1 ? "" : "s"} left
                      </span>
                    )}
                  </span>
                  <LoadBar driver={d} className="mt-2" />
                </span>
                <CheckMark />
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function VehicleChoices({
  vehicles,
  driverId,
  value,
  onChange,
  disabled,
}: {
  vehicles: DispatchVehicle[];
  driverId: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const name = useId();
  // Usable vehicles first, then the rest; stable by registration otherwise.
  const sorted = [...vehicles].sort(
    (a, b) =>
      Number(vehicleDisabled(a, driverId)) - Number(vehicleDisabled(b, driverId)) ||
      a.registrationNumber.localeCompare(b.registrationNumber),
  );
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold">Vehicle</legend>
      {sorted.length === 0 ? (
        <p className="rounded-xl bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">No vehicles in the fleet yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {sorted.map((v) => {
            const off = vehicleDisabled(v, driverId);
            const hint = vehicleHint(v, driverId);
            const mine = !!driverId && v.currentDriverId === driverId;
            return (
              <label key={v.id} className={CHOICE}>
                <input
                  type="radio"
                  name={name}
                  value={v.id}
                  checked={value === v.id}
                  disabled={off}
                  onChange={() => onChange(v.id)}
                  className="sr-only"
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-mono text-sm font-semibold tracking-wide", off && "text-muted-foreground")}>
                    {v.registrationNumber}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    <VehicleTypeLabel type={v.type} />
                    {v.capacity ? ` · ${v.capacity}` : ""}
                  </span>
                  <span className="mt-1 block text-xs">
                    {hint ? (
                      <span className="font-medium text-muted-foreground">{hint}</span>
                    ) : mine ? (
                      <span className="font-medium text-primary">Driver&apos;s current vehicle</span>
                    ) : (
                      <span className="text-muted-foreground">Free</span>
                    )}
                  </span>
                </span>
                <CheckMark />
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

/** Pick the vehicle a driver already holds (if usable), else keep the current one if still valid. */
export function vehicleForDriver(vehicles: DispatchVehicle[], driverId: string, currentVehicleId: string): string {
  const held = vehicles.find((v) => v.currentDriverId === driverId && v.status === "ACTIVE");
  if (held) return held.id;
  const current = vehicles.find((v) => v.id === currentVehicleId);
  return current && !vehicleDisabled(current, driverId) ? current.id : "";
}
