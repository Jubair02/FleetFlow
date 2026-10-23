"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { deadlineMs, friendlyDueDate, initials } from "@/lib/format";
import { AVAILABILITY_LABELS } from "@/lib/constants";
import type { AssignmentHistoryItem, Delivery, DispatchDriver, DispatchVehicle } from "@/lib/types";
import { goToDelivery } from "@/store/app-store";
import { Progress } from "@/components/ui/progress";
import { splitAddress } from "@/components/fleetflow/driver/job-utils";

export type ActiveAssignment = AssignmentHistoryItem & { delivery: Delivery };

// ── Driver / vehicle rules (shared by single + bulk assign) ───

export function remainingSlots(d: DispatchDriver): number {
  return Math.max(0, d.maxActiveJobs - d.activeJobs);
}

export function driverDisabled(d: DispatchDriver): boolean {
  return !d.active || d.availability === "OFF_DUTY" || d.activeJobs >= d.maxActiveJobs;
}

export function driverHint(d: DispatchDriver): string | null {
  if (!d.active) return "Inactive";
  if (d.availability === "OFF_DUTY") return "Off duty";
  if (d.activeJobs >= d.maxActiveJobs) return "At capacity";
  return null;
}

/** A vehicle is held by one driver at a time — another driver can't take it. */
export function heldByOther(v: DispatchVehicle, driverId: string): boolean {
  return !!v.currentDriverId && v.currentDriverId !== driverId;
}

export function vehicleDisabled(v: DispatchVehicle, driverId: string): boolean {
  return v.status !== "ACTIVE" || heldByOther(v, driverId);
}

export function vehicleHint(v: DispatchVehicle, driverId: string): string | null {
  if (v.status === "MAINTENANCE") return "In maintenance";
  if (v.status === "INACTIVE") return "Inactive";
  if (heldByOther(v, driverId)) return `In use by ${v.currentDriverName ?? "another driver"}`;
  return null;
}

/** Available first, then on route, off duty, inactive last. */
export function driverRank(d: DispatchDriver): number {
  if (!d.active) return 3;
  if (d.availability === "AVAILABLE") return 0;
  if (d.availability === "ON_ROUTE") return 1;
  return 2;
}

export function byDriverRank(a: DispatchDriver, b: DispatchDriver): number {
  return driverRank(a) - driverRank(b) || a.name.localeCompare(b.name);
}

export function availabilityLabel(d: DispatchDriver): string {
  if (!d.active) return "Inactive";
  return AVAILABILITY_LABELS[d.availability as keyof typeof AVAILABILITY_LABELS] ?? d.availability;
}

/** Free = active, on duty and with at least one open slot. */
export function isDriverFree(d: DispatchDriver): boolean {
  return !driverDisabled(d);
}

// ── Queue helpers ─────────────────────────────────────────────

export function isPastDue(d: Delivery, nowMs: number): boolean {
  return !!d.expectedAt && deadlineMs(d.expectedAt) < nowMs;
}

export function areaOf(d: Delivery): string {
  return splitAddress(d.deliveryAddress).line2 ?? "No area";
}

export function dueTime(d: Delivery): number {
  return d.expectedAt ? new Date(d.expectedAt).getTime() : Number.POSITIVE_INFINITY;
}

// ── Small presentational pieces ───────────────────────────────

export function TrackingLink({ delivery, className }: { delivery: Delivery; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => goToDelivery(delivery.id)}
      className={cn(
        "rounded-md font-mono text-[13px] font-semibold tracking-wide text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
      aria-label={`Open delivery ${delivery.trackingCode}`}
    >
      {delivery.trackingCode}
    </button>
  );
}

export function DueText({ delivery, nowMs, className }: { delivery: Delivery; nowMs: number; className?: string }) {
  const overdue = isPastDue(delivery, nowMs);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums",
        overdue ? "font-medium text-rose-700 dark:text-rose-400" : "text-muted-foreground",
        className,
      )}
    >
      {overdue ? <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" /> : <Clock className="size-3.5 shrink-0" aria-hidden="true" />}
      {overdue ? <span className="sr-only">Overdue, was due </span> : null}
      {friendlyDueDate(delivery.expectedAt)}
    </span>
  );
}

/** Rounded-square initials avatar. */
export function Squircle({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/15 dark:bg-primary/15",
        className,
      )}
      aria-hidden="true"
    >
      {initials(name) || "?"}
    </span>
  );
}

/** Availability dot — the label is always shown next to it, so colour is never the only signal. */
export function AvailabilityDot({ driver, className }: { driver: DispatchDriver; className?: string }) {
  const style = !driver.active
    ? "border border-dashed border-zinc-400 bg-transparent"
    : driver.availability === "AVAILABLE"
      ? "bg-emerald-500"
      : driver.availability === "ON_ROUTE"
        ? "border-2 border-emerald-500 bg-transparent"
        : "bg-zinc-400";
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", style, className)} aria-hidden="true" />;
}

export function LoadBar({ driver, className }: { driver: DispatchDriver; className?: string }) {
  const pct = Math.min(100, (driver.activeJobs / Math.max(1, driver.maxActiveJobs)) * 100);
  const dim = driverDisabled(driver) && driver.activeJobs < driver.maxActiveJobs;
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Progress
        value={pct}
        aria-label={`${driver.name}: ${driver.activeJobs} of ${driver.maxActiveJobs} active jobs`}
        className={cn("h-1.5 flex-1 bg-muted", dim && "[&_[data-slot=progress-indicator]]:bg-zinc-400")}
      />
      <span className="text-xs font-medium tabular-nums text-muted-foreground">
        {driver.activeJobs}/{driver.maxActiveJobs}
      </span>
    </span>
  );
}

export function SectionLabel({ children, count, action }: { children: ReactNode; count?: number; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2">
      <h3 className="text-sm font-semibold tracking-tight">{children}</h3>
      {count !== undefined ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
      ) : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}
