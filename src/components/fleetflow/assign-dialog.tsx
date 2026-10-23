"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, MapPin, Truck } from "lucide-react";

import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { Delivery, DispatchData } from "@/lib/types";
import { failureReasonLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityMarker, SheetBody, SheetDialogContent, SheetFooter, SheetHeader } from "@/components/fleetflow/driver/ui";
import { PRESS, splitAddress } from "@/components/fleetflow/driver/job-utils";
import { DriverChoices, VehicleChoices, vehicleForDriver } from "@/components/fleetflow/dispatch/crew-picker";
import { DueText, vehicleDisabled } from "@/components/fleetflow/dispatch/helpers";

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
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submitting) return;
        onOpenChange(o);
      }}
    >
      <SheetDialogContent className="sm:max-w-2xl" closeDisabled={submitting}>
        <SheetHeader
          title="Assign driver and vehicle"
          description="Pick an available driver and a vehicle. Capacity and vehicle availability are checked again when you confirm."
        />
        {/* Content mounts on every opening, so selections always start fresh. */}
        <AssignForm
          key={delivery?.id ?? "none"}
          delivery={delivery}
          submitting={submitting}
          setSubmitting={setSubmitting}
          onClose={() => onOpenChange(false)}
        />
      </SheetDialogContent>
    </Dialog>
  );
}

export function DeliverySummary({ delivery }: { delivery: Delivery }) {
  const { line1, line2 } = splitAddress(delivery.deliveryAddress);
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/40 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-semibold tracking-wide">{delivery.trackingCode}</span>
        <PriorityMarker priority={delivery.priority} className="h-6" />
        {delivery.status === "FAILED" ? (
          <span className="inline-flex h-6 items-center rounded-full bg-rose-50 px-2.5 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-600/15 dark:bg-rose-950/60 dark:text-rose-300">
            Failed · {failureReasonLabel(delivery.failureReason)}
          </span>
        ) : null}
        <DueText delivery={delivery} nowMs={Date.now()} className="ml-auto" />
      </div>
      <p className="mt-2 text-[15px] font-medium">{delivery.recipientName}</p>
      <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">
          <span className="text-foreground">{line1}</span>
          {line2 ? <span>, {line2}</span> : null}
        </span>
      </p>
    </div>
  );
}

function AssignForm({
  delivery,
  submitting,
  setSubmitting,
  onClose,
}: {
  delivery: Delivery | null;
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onClose: () => void;
}) {
  const { data, loading, error } = useApiData<DispatchData>("/api/dispatch");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");

  const drivers = data?.drivers ?? [];
  const vehicles = data?.vehicles ?? [];
  const selectedDriver = drivers.find((d) => d.id === driverId) ?? null;
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const vehicleConflict = !!selectedVehicle && vehicleDisabled(selectedVehicle, driverId);

  const canSubmit = !!delivery && !!driverId && !!vehicleId && !vehicleConflict && !submitting;

  function handleDriverChange(id: string) {
    setDriverId(id);
    // Prefer the vehicle this driver already holds; drop one they can't take.
    setVehicleId(vehicleForDriver(vehicles, id, vehicleId));
  }

  async function handleSubmit() {
    if (!delivery) return;
    if (!driverId || !vehicleId) {
      toast.error("Select a driver and a vehicle before dispatching");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/deliveries/${delivery.id}/assign`, { driverId, vehicleId });
      toast.success(`${delivery.trackingCode} assigned to ${selectedDriver?.name ?? "driver"}`);
      onClose();
      useAppStore.getState().bump();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign delivery");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SheetBody className="space-y-5">
        {delivery ? <DeliverySummary delivery={delivery} /> : null}

        {loading && !data ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-4 w-16" />
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[76px] rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-4 w-16" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-[76px] rounded-xl" />
              <Skeleton className="h-[76px] rounded-xl" />
            </div>
          </div>
        ) : error && !data ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>Couldn&apos;t load drivers and vehicles: {error}</span>
          </div>
        ) : (
          <>
            <DriverChoices drivers={drivers} value={driverId} onChange={handleDriverChange} disabled={submitting} />
            <VehicleChoices
              vehicles={vehicles}
              driverId={driverId}
              value={vehicleId}
              onChange={setVehicleId}
              disabled={submitting}
            />
          </>
        )}
      </SheetBody>

      <SheetFooter>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-xl sm:min-h-10"
          disabled={submitting}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className={cn("min-h-11 rounded-xl font-semibold shadow-sm sm:min-h-10", PRESS)}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? <Loader2 className="animate-spin" /> : <Truck />}
          {selectedDriver ? `Dispatch with ${selectedDriver.name.split(" ")[0]}` : "Dispatch delivery"}
        </Button>
      </SheetFooter>

      <p className="sr-only" aria-live="polite">
        {selectedDriver && selectedVehicle
          ? `Ready to assign ${selectedDriver.name} with vehicle ${selectedVehicle.registrationNumber}`
          : "Select a driver and a vehicle"}
      </p>
    </>
  );
}
