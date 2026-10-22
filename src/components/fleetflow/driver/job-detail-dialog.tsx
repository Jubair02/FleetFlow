"use client";

import { AlertTriangle, ArrowUpFromLine, Clock, Info, MapPin, Phone, RefreshCw, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { formatDateTime, friendlyDueDate } from "@/lib/format";
import type { Delivery, DeliveryDetail } from "@/lib/types";
import { VehicleTypeLabel } from "@/components/fleetflow/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { isOverdue } from "./job-utils";
import { PriorityMarker, SheetBody, SheetDialogContent, SheetHeader, StatusPill } from "./ui";

/** Pickup → dropoff route block with a dashed connector. */
export function RouteBlock({ job }: { job: Delivery }) {
  return (
    <div className="rounded-2xl border border-border/70 p-4 dark:border-white/10">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
          <ArrowUpFromLine className="size-3.5 text-muted-foreground" />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pickup</p>
          <p className="text-sm leading-snug text-muted-foreground">{job.pickupAddress}</p>
        </div>
      </div>
      <div className="ml-[13px] h-4 border-l-2 border-dashed border-border" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
          <MapPin className="size-3.5 text-primary" />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Deliver to</p>
          <p className="text-[15px] font-medium leading-snug">{job.deliveryAddress}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 pl-10">
        <span className="text-[15px] font-semibold">{job.recipientName}</span>
        {job.recipientPhone ? (
          <Button asChild variant="outline" className="h-11 gap-1.5 rounded-xl">
            <a href={`tel:${job.recipientPhone}`} aria-label={`Call ${job.recipientName}`}>
              <Phone className="size-4" aria-hidden="true" />
              <span className="tabular-nums">{job.recipientPhone}</span>
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function MetaBlock({ job, registration, vehicleType }: { job: Delivery; registration?: string | null; vehicleType?: string | null }) {
  const overdue = isOverdue(job);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          Expected
          <span className={cn("font-medium", overdue ? "text-rose-700 dark:text-rose-400" : "text-foreground")}>
            {friendlyDueDate(job.expectedAt)}
            {overdue ? " (overdue)" : ""}
          </span>
        </span>
        {registration ? (
          <span className="inline-flex items-center gap-1.5">
            <Truck className="size-4 shrink-0" aria-hidden="true" />
            <span className="font-mono font-medium text-foreground">{registration}</span>
            {vehicleType ? (
              <span>
                · <VehicleTypeLabel type={vehicleType} />
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {job.instructions ? <InstructionsCallout text={job.instructions} /> : null}
    </div>
  );
}

export function InstructionsCallout({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl bg-amber-50 p-3.5 text-sm text-amber-950 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900/60",
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
      <span className="min-w-0 break-words">
        <span className="sr-only">Instructions: </span>
        {text}
      </span>
    </div>
  );
}

function eventDotColor(eventType: string): string {
  if (eventType === "DELIVERED") return "bg-emerald-500";
  if (eventType === "FAILED") return "bg-rose-500";
  return "bg-zinc-300 dark:bg-zinc-600";
}

/** Job detail — opened via focusDeliveryId (job cards, notifications…). */
export function JobDetailDialog() {
  const focusDeliveryId = useAppStore((s) => s.focusDeliveryId);
  const focusDelivery = useAppStore((s) => s.focusDelivery);
  const { data, loading, error, reload } = useApiData<DeliveryDetail>(
    focusDeliveryId ? `/api/deliveries/${focusDeliveryId}` : null,
  );
  const detail = data && data.delivery.id === focusDeliveryId ? data : null;
  const job = detail?.delivery;

  return (
    <Dialog open={!!focusDeliveryId} onOpenChange={(open) => { if (!open) focusDelivery(null); }}>
      <SheetDialogContent className="sm:max-w-lg">
        <SheetHeader
          title={
            <span className="flex flex-col gap-2">
              <span className="font-mono text-base tracking-wider">{job?.trackingCode ?? "Job details"}</span>
              {job ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusPill status={job.status} />
                  <PriorityMarker priority={job.priority} />
                </span>
              ) : null}
            </span>
          }
          description="Full job record — route, timeline and proof of delivery."
        />

        <SheetBody>
          {loading && !detail ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-36 w-full rounded-2xl" />
            </div>
          ) : error && !detail ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/70 p-6 text-center dark:border-white/10">
              <span className="flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60">
                <AlertTriangle className="size-6 text-amber-600 dark:text-amber-300" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[15px] font-semibold">This job isn&apos;t available</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  It may have been reassigned to another driver or removed. ({error})
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={reload}>
                  <RefreshCw className="size-4" aria-hidden="true" /> Try again
                </Button>
                <Button type="button" className="h-11 rounded-xl" onClick={() => focusDelivery(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : detail && job ? (
            <div className="flex flex-col gap-5">
              <RouteBlock job={job} />
              <MetaBlock
                job={job}
                registration={job.assignment?.vehicleRegistration ?? null}
                vehicleType={job.assignment?.vehicleType ?? null}
              />

              <section>
                <h3 className="mb-3 text-sm font-semibold tracking-tight">Timeline</h3>
                {detail.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events recorded yet.</p>
                ) : (
                  <ol>
                    {detail.events
                      .slice()
                      .reverse()
                      .map((ev) => (
                        <li key={ev.id} className="relative ml-1 border-l pb-4 pl-5 last:border-transparent last:pb-0">
                          <span
                            className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-background", eventDotColor(ev.eventType))}
                            aria-hidden="true"
                          />
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-medium">{EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}</span>
                            <span className="text-sm tabular-nums text-muted-foreground">{formatDateTime(ev.createdAt)}</span>
                          </div>
                          {ev.note ? <p className="mt-0.5 break-words text-sm text-muted-foreground">{ev.note}</p> : null}
                          {ev.actorName ? <p className="mt-0.5 text-sm text-muted-foreground">by {ev.actorName}</p> : null}
                        </li>
                      ))}
                  </ol>
                )}
              </section>

              {detail.pods.length > 0 ? (
                <section>
                  <h3 className="mb-3 text-sm font-semibold tracking-tight">Proof of delivery</h3>
                  <div className="flex flex-wrap gap-3">
                    {detail.pods.map((pod) => (
                      <figure key={pod.id} className="w-32">
                        { }
                        <img
                          src={`/api/pod/${pod.id}`}
                          alt={`${pod.kind === "PHOTO" ? "Photo" : "Signature"} proof for ${job.trackingCode}`}
                          className="h-24 w-32 rounded-xl border bg-white object-contain p-1"
                        />
                        <figcaption className="mt-1.5 text-xs leading-snug text-muted-foreground">
                          {pod.kind === "PHOTO" ? "Photo" : "Signature"} · {formatDateTime(pod.capturedAt)}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </SheetBody>
      </SheetDialogContent>
    </Dialog>
  );
}
