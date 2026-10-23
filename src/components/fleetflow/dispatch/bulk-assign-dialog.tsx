"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2, Truck, XCircle } from "lucide-react";

import { api } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { Delivery, DispatchDriver, DispatchVehicle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { SheetBody, SheetDialogContent, SheetFooter, SheetHeader } from "@/components/fleetflow/driver/ui";
import { PRESS } from "@/components/fleetflow/driver/job-utils";
import { DriverChoices, VehicleChoices, vehicleForDriver } from "./crew-picker";
import { remainingSlots, vehicleDisabled } from "./helpers";

type RowResult = { state: "pending" | "running" | "ok" | "error"; message?: string };

export function BulkAssignDialog({
  open,
  deliveries,
  drivers,
  vehicles,
  onOpenChange,
  onFinished,
}: {
  open: boolean;
  /** Snapshot taken when the dialog opened — it doesn't shrink as deliveries leave the queue. */
  deliveries: Delivery[];
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
  onOpenChange: (o: boolean) => void;
  /** Called once the run ends with the ids that could not be assigned. */
  onFinished: (failedIds: string[]) => void;
}) {
  const [running, setRunning] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (running) return;
        onOpenChange(o);
      }}
    >
      <SheetDialogContent className="sm:max-w-2xl" closeDisabled={running}>
        <SheetHeader
          title={`Assign ${deliveries.length} ${deliveries.length === 1 ? "delivery" : "deliveries"}`}
          description="All selected deliveries go to one driver and vehicle. Each one is assigned in turn and you'll see the result for every delivery."
        />
        <BulkForm
          key={deliveries.map((d) => d.id).join(",")}
          deliveries={deliveries}
          drivers={drivers}
          vehicles={vehicles}
          running={running}
          setRunning={setRunning}
          onClose={() => onOpenChange(false)}
          onFinished={onFinished}
        />
      </SheetDialogContent>
    </Dialog>
  );
}

function BulkForm({
  deliveries,
  drivers,
  vehicles,
  running,
  setRunning,
  onClose,
  onFinished,
}: {
  deliveries: Delivery[];
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
  running: boolean;
  setRunning: (b: boolean) => void;
  onClose: () => void;
  onFinished: (failedIds: string[]) => void;
}) {
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [done, setDone] = useState(false);

  const driver = drivers.find((d) => d.id === driverId) ?? null;
  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const vehicleConflict = !!vehicle && vehicleDisabled(vehicle, driverId);
  const slots = driver ? remainingSlots(driver) : 0;
  const overCapacity = !!driver && deliveries.length > slots;

  const finished = Object.values(results).filter((r) => r.state === "ok" || r.state === "error").length;
  const okCount = Object.values(results).filter((r) => r.state === "ok").length;
  const errorCount = Object.values(results).filter((r) => r.state === "error").length;
  const started = running || done;
  const canRun = !!driverId && !!vehicleId && !vehicleConflict && !started && deliveries.length > 0;

  function handleDriverChange(id: string) {
    setDriverId(id);
    setVehicleId(vehicleForDriver(vehicles, id, vehicleId));
  }

  async function run() {
    if (!canRun) return;
    setRunning(true);
    const initial: Record<string, RowResult> = {};
    for (const d of deliveries) initial[d.id] = { state: "pending" };
    setResults(initial);
    const failed: string[] = [];
    // Sequential on purpose: the server re-checks capacity on every call.
    for (const d of deliveries) {
      setResults((r) => ({ ...r, [d.id]: { state: "running" } }));
      try {
        await api.post(`/api/deliveries/${d.id}/assign`, { driverId, vehicleId });
        setResults((r) => ({ ...r, [d.id]: { state: "ok" } }));
      } catch (e) {
        failed.push(d.id);
        const message = e instanceof Error ? e.message : "Failed to assign delivery";
        setResults((r) => ({ ...r, [d.id]: { state: "error", message } }));
      }
    }
    setRunning(false);
    setDone(true);
    onFinished(failed);
    useAppStore.getState().bump();
  }

  return (
    <>
      <SheetBody className="space-y-5">
        <section aria-labelledby="bulk-list-heading" className="rounded-2xl border border-border/70 bg-muted/40 dark:border-white/10">
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            <h3 id="bulk-list-heading" className="text-sm font-semibold">
              Selected deliveries
            </h3>
            {started ? (
              <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground" aria-live="polite">
                {done
                  ? `${okCount} assigned${errorCount ? ` · ${errorCount} failed` : ""}`
                  : `Assigning ${Math.min(finished + 1, deliveries.length)} of ${deliveries.length}…`}
              </span>
            ) : null}
          </div>
          {started ? (
            <div className="px-4 pb-2">
              <Progress
                value={(finished / Math.max(1, deliveries.length)) * 100}
                aria-label={`${finished} of ${deliveries.length} deliveries processed`}
                className="h-1.5"
              />
            </div>
          ) : null}
          <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto px-4 pb-1 dark:divide-white/10">
            {deliveries.map((d) => {
              const r = results[d.id];
              return (
                <li key={d.id} className="flex items-start gap-2.5 py-2 text-sm">
                  <span className="mt-0.5 shrink-0">
                    {!r || r.state === "pending" ? (
                      <Circle className="size-4 text-muted-foreground/60" aria-hidden="true" />
                    ) : r.state === "running" ? (
                      <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                    ) : r.state === "ok" ? (
                      <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
                    ) : (
                      <XCircle className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-[13px] font-semibold tracking-wide">{d.trackingCode}</span>
                    <span className="text-muted-foreground"> · {d.recipientName}</span>
                    {r?.state === "error" ? (
                      <span className="mt-0.5 block text-xs font-medium text-rose-700 dark:text-rose-400">{r.message}</span>
                    ) : null}
                  </span>
                  <span className="sr-only">
                    {!r ? "" : r.state === "ok" ? "Assigned" : r.state === "error" ? "Failed" : r.state === "running" ? "Assigning" : "Waiting"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <DriverChoices drivers={drivers} value={driverId} onChange={handleDriverChange} disabled={started} />

        {overCapacity && !started ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {driver!.name} has {slots} open slot{slots === 1 ? "" : "s"} but {deliveries.length} deliveries are selected. The
              extra ones will be refused and stay selected.
            </span>
          </div>
        ) : null}

        <VehicleChoices vehicles={vehicles} driverId={driverId} value={vehicleId} onChange={setVehicleId} disabled={started} />
      </SheetBody>

      <SheetFooter>
        {done ? (
          <Button type="button" className={cn("min-h-11 rounded-xl font-semibold sm:min-h-10", PRESS)} onClick={onClose}>
            {errorCount ? "Close — failed ones stay selected" : "Done"}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" className="min-h-11 rounded-xl sm:min-h-10" disabled={running} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              className={cn("min-h-11 rounded-xl font-semibold shadow-sm sm:min-h-10", PRESS)}
              disabled={!canRun}
              onClick={() => void run()}
            >
              {running ? <Loader2 className="animate-spin" /> : <Truck />}
              Assign {deliveries.length} {deliveries.length === 1 ? "delivery" : "deliveries"}
            </Button>
          </>
        )}
      </SheetFooter>
    </>
  );
}
