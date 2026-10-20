"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Truck } from "lucide-react";

import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { Delivery, DispatchData, DispatchDriver, DispatchVehicle } from "@/lib/types";
import { AVAILABILITY_LABELS } from "@/lib/constants";
import { PriorityBadge, VehicleTypeLabel } from "@/components/fleetflow/badges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ── Driver option helpers ─────────────────────────────────────

function driverDisabled(d: DispatchDriver): boolean {
  return !d.active || d.availability === "OFF_DUTY" || d.activeJobs >= d.maxActiveJobs;
}

function driverHint(d: DispatchDriver): string | null {
  if (!d.active) return "inactive";
  if (d.availability === "OFF_DUTY") return "off duty";
  if (d.activeJobs >= d.maxActiveJobs) return "at capacity";
  return null;
}

function vehicleDisabled(v: DispatchVehicle): boolean {
  return v.status !== "ACTIVE";
}

function vehicleHint(v: DispatchVehicle): string | null {
  if (v.status === "MAINTENANCE") return "in maintenance";
  if (v.status === "INACTIVE") return "inactive";
  return null;
}

// ── Assign dialog ─────────────────────────────────────────────

export function AssignDialog({
  delivery,
  open,
  onOpenChange,
}: {
  delivery: Delivery | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data, loading } = useApiData<DispatchData>(open ? "/api/dispatch" : null);
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Clean up selections whenever the dialog is (re)opened for a delivery.
  useEffect(() => {
    if (open) {
      setDriverId("");
      setVehicleId("");
      setSubmitting(false);
    }
  }, [open, delivery?.id]);

  const drivers = data?.drivers ?? [];
  const vehicles = data?.vehicles ?? [];
  const selectedDriver = drivers.find((d) => d.id === driverId) ?? null;
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

  const canSubmit = !!driverId && !!vehicleId && !submitting;

  async function handleSubmit() {
    if (!delivery) return;
    if (!driverId || !vehicleId) {
      toast.error("Select a driver and a vehicle before dispatching");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/deliveries/${delivery.id}/assign`, { driverId, vehicleId });
      toast.success("Delivery dispatched");
      useAppStore.getState().bump();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign delivery");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submitting) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Assign driver &amp; vehicle</DialogTitle>
          <DialogDescription>
            Dispatch this delivery to an available driver. Capacity and availability are enforced.
          </DialogDescription>
        </DialogHeader>

        {delivery ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-mono font-medium">{delivery.trackingCode}</span>
            <span className="text-muted-foreground">·</span>
            <span className="truncate">{delivery.recipientName}</span>
            <PriorityBadge priority={delivery.priority} />
          </div>
        ) : null}

        {loading && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-9 w-1/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Driver */}
            <div className="space-y-2">
              <Label htmlFor="assign-driver">Driver</Label>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger id="assign-driver" className="min-h-11 w-full sm:min-h-9">
                  <SelectValue placeholder="Select a driver" />
                </SelectTrigger>
                <SelectContent>
                  {drivers.length === 0 ? (
                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                      No drivers available
                    </div>
                  ) : (
                    drivers.map((d) => {
                      const hint = driverHint(d);
                      return (
                        <SelectItem key={d.id} value={d.id} disabled={driverDisabled(d)}>
                          <span className="font-medium">{d.name}</span>
                          <span className="text-muted-foreground">
                            — {d.activeJobs}/{d.maxActiveJobs} active
                          </span>
                          <span className="text-muted-foreground">
                            · {AVAILABILITY_LABELS[d.availability as keyof typeof AVAILABILITY_LABELS] ?? d.availability}
                          </span>
                          {hint ? <span className="text-amber-600 dark:text-amber-400">· {hint}</span> : null}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>

              {selectedDriver ? (
                <div className="space-y-1.5 rounded-md bg-muted/40 px-3 py-2">
                  <Progress
                    value={(selectedDriver.activeJobs / Math.max(1, selectedDriver.maxActiveJobs)) * 100}
                    className="h-1.5"
                  />
                  <p className="text-xs text-muted-foreground">
                    Workload: {selectedDriver.activeJobs}/{selectedDriver.maxActiveJobs} active jobs
                    {selectedDriver.activeJobs >= selectedDriver.maxActiveJobs
                      ? " — at capacity"
                      : selectedDriver.availability === "OFF_DUTY"
                        ? " — off duty"
                        : selectedDriver.availability === "ON_ROUTE"
                          ? " — currently on route"
                          : " — available for dispatch"}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Vehicle */}
            <div className="space-y-2">
              <Label htmlFor="assign-vehicle">Vehicle</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger id="assign-vehicle" className="min-h-11 w-full sm:min-h-9">
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.length === 0 ? (
                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                      No vehicles in the fleet
                    </div>
                  ) : (
                    vehicles.map((v) => {
                      const hint = vehicleHint(v);
                      return (
                        <SelectItem key={v.id} value={v.id} disabled={vehicleDisabled(v)}>
                          <span className="font-mono font-medium">{v.registrationNumber}</span>
                          <span className="text-muted-foreground">
                            · <VehicleTypeLabel type={v.type} />
                            {v.capacity ? ` · ${v.capacity}` : ""}
                          </span>
                          {hint ? <span className="text-amber-600 dark:text-amber-400">· {hint}</span> : null}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
              {selectedVehicle ? (
                <p className="text-xs text-muted-foreground">
                  {selectedVehicle.activeJobs} active job{selectedVehicle.activeJobs === 1 ? "" : "s"} on this
                  vehicle today.
                </p>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className={cn("min-h-11 sm:min-h-9")}
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11 sm:min-h-9"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <Truck />}
            Dispatch delivery
          </Button>
        </DialogFooter>

        <p className="sr-only" aria-live="polite">
          {selectedDriver && selectedVehicle
            ? `Ready to assign ${selectedDriver.name} with vehicle ${selectedVehicle.registrationNumber}`
            : "Select a driver and a vehicle"}
        </p>
      </DialogContent>
    </Dialog>
  );
}
