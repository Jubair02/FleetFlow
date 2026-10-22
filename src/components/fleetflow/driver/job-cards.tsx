"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coffee,
  Eye,
  Loader2,
  MoreHorizontal,
  Navigation,
  PackageCheck,
  Phone,
  RefreshCw,
  Sparkles,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { friendlyDueDate } from "@/lib/format";
import type { MyJob } from "@/lib/types";
import { VehicleTypeLabel } from "@/components/fleetflow/badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { InstructionsCallout } from "./job-detail-dialog";
import { CARD_SURFACE, ENTER_MOTION, PRESS, isOverdue, navigateUrl, navigationTarget, splitAddress, type Transition } from "./job-utils";
import { PriorityMarker, StatusPill } from "./ui";

export interface JobHandlers {
  busyId: string | null;
  onTransition: (job: MyJob, status: Transition) => void;
  onOpenPod: (job: MyJob) => void;
  onOpenReport: (job: MyJob) => void;
  onOpenDetail: (job: MyJob) => void;
}

type PrimaryAction = { label: string; icon: LucideIcon; run: () => void; needsIdle: boolean };

/** The single forward step for a job's current status (same transitions as before). */
function primaryAction(job: MyJob, h: JobHandlers): PrimaryAction | null {
  if (job.status === "ASSIGNED") return { label: "Confirm pickup", icon: PackageCheck, run: () => h.onTransition(job, "PICKED_UP"), needsIdle: true };
  if (job.status === "PICKED_UP") return { label: "Start delivery", icon: Truck, run: () => h.onTransition(job, "IN_TRANSIT"), needsIdle: true };
  if (job.status === "IN_TRANSIT") return { label: "Complete delivery", icon: CheckCircle2, run: () => h.onOpenPod(job), needsIdle: false };
  return null;
}

function PrimaryActionButton({ job, h, className }: { job: MyJob; h: JobHandlers; className?: string }) {
  const action = primaryAction(job, h);
  if (!action) return null;
  const busy = h.busyId === job.id;
  const Icon = action.icon;
  return (
    <Button
      type="button"
      className={cn("rounded-xl font-semibold shadow-sm", PRESS, className)}
      disabled={action.needsIdle && busy}
      onClick={action.run}
    >
      {busy && action.needsIdle ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Icon className="size-5" aria-hidden="true" />}
      {action.label}
    </Button>
  );
}

function DueLine({ job, className }: { job: MyJob; className?: string }) {
  const overdue = isOverdue(job);
  return (
    <span className={cn("inline-flex items-center gap-1.5", overdue ? "font-medium text-rose-700 dark:text-rose-400" : "text-muted-foreground", className)}>
      {overdue ? <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> : <Clock className="size-4 shrink-0" aria-hidden="true" />}
      <span>
        {overdue ? "Overdue · " : job.expectedAt ? "Due " : ""}
        <span className={cn("tabular-nums", !overdue && "text-foreground")}>{friendlyDueDate(job.expectedAt)}</span>
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Next stop — the featured, most urgent job
// ─────────────────────────────────────────────────────────────

export function NextStopCard({ job, h }: { job: MyJob; h: JobHandlers }) {
  const busy = h.busyId === job.id;
  const { line1, line2 } = splitAddress(job.deliveryAddress);
  const { toPickup } = navigationTarget(job);
  const registration = job.vehicle?.registrationNumber ?? job.assignment?.vehicleRegistration ?? null;
  const vehicleType = job.vehicle?.type ?? job.assignment?.vehicleType ?? null;

  return (
    <article className={cn(CARD_SURFACE, ENTER_MOTION, "overflow-hidden")} aria-labelledby={`next-stop-${job.id}`}>
      <button
        type="button"
        onClick={() => h.onOpenDetail(job)}
        className="group block w-full p-5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 sm:p-6"
        aria-label={`View details for ${job.trackingCode}`}
      >
        <span className="flex items-center gap-2">
          <span id={`next-stop-${job.id}`} className="text-xs font-semibold uppercase tracking-wider text-primary">
            {toPickup ? "Next pickup" : "Next stop"}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <PriorityMarker priority={job.priority} />
            <StatusPill status={job.status} />
          </span>
        </span>

        <span className="mt-4 block text-xl font-semibold leading-snug tracking-tight text-balance break-words sm:text-2xl">{line1}</span>
        {line2 ? <span className="mt-1 block text-[15px] text-muted-foreground">{line2}</span> : null}

        <span className="mt-4 flex flex-col gap-2.5 text-sm">
          <span className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
              {job.recipientName.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium text-foreground">{job.recipientName}</span>
              {job.recipientPhone ? <span className="block tabular-nums text-muted-foreground">{job.recipientPhone}</span> : null}
            </span>
          </span>
          <span className={cn("flex items-start gap-2 rounded-xl px-3 py-2.5", toPickup ? "bg-primary/[0.06] dark:bg-primary/10" : "bg-muted/60")}>
            <span className={cn("shrink-0 font-medium", toPickup ? "text-primary" : "text-muted-foreground")}>Pickup</span>
            <span className={cn("min-w-0 break-words", toPickup ? "text-foreground" : "text-muted-foreground")}>{job.pickupAddress}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <DueLine job={job} />
            {registration ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Truck className="size-4 shrink-0" aria-hidden="true" />
                <span className="font-mono text-xs font-medium tracking-wider text-foreground">{registration}</span>
                {vehicleType ? (
                  <span>
                    · <VehicleTypeLabel type={vehicleType} />
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </span>
        <span className="mt-3 flex items-center gap-1 font-mono text-xs tracking-wider text-muted-foreground">
          {job.trackingCode}
          <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </button>

      {job.instructions ? <InstructionsCallout text={job.instructions} className="mx-5 sm:mx-6" /> : null}

      <div className="flex flex-col gap-2 p-5 pt-4 sm:p-6 sm:pt-4">
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline" className={cn("h-12 rounded-xl text-[15px]", !job.recipientPhone && "col-span-2", PRESS)}>
            <a href={navigateUrl(job)} target="_blank" rel="noopener noreferrer">
              <Navigation className="size-4" aria-hidden="true" />
              {toPickup ? "To pickup" : "Navigate"}
              <span className="sr-only"> (opens Google Maps)</span>
            </a>
          </Button>
          {job.recipientPhone ? (
            <Button asChild variant="outline" className={cn("h-12 rounded-xl text-[15px]", PRESS)}>
              <a href={`tel:${job.recipientPhone}`} aria-label={`Call ${job.recipientName}`}>
                <Phone className="size-4" aria-hidden="true" />
                Call
              </a>
            </Button>
          ) : null}
        </div>
        <PrimaryActionButton job={job} h={h} className="h-14 w-full text-base" />
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full rounded-xl text-sm text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
          disabled={busy}
          onClick={() => h.onOpenReport(job)}
        >
          <AlertTriangle className="size-4" aria-hidden="true" />
          Report problem
        </Button>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// Up next — compact cards
// ─────────────────────────────────────────────────────────────

export function JobCard({ job, h, index = 0 }: { job: MyJob; h: JobHandlers; index?: number }) {
  const busy = h.busyId === job.id;
  const { toPickup } = navigationTarget(job);
  return (
    <article
      className={cn(CARD_SURFACE, ENTER_MOTION, "flex flex-col overflow-hidden")}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms`, animationFillMode: "backwards" }}
    >
      <button
        type="button"
        onClick={() => h.onOpenDetail(job)}
        className="block w-full flex-1 p-4 pb-3 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        aria-label={`View details for ${job.trackingCode}`}
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate font-mono text-xs tracking-wider text-muted-foreground">{job.trackingCode}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <PriorityMarker priority={job.priority} />
            <StatusPill status={job.status} />
          </span>
        </span>
        <span className="mt-2 line-clamp-2 block text-[15px] font-medium leading-snug break-words">{job.deliveryAddress}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="max-w-full truncate text-muted-foreground">{job.recipientName}</span>
          <DueLine job={job} />
        </span>
      </button>
      <div className="flex items-center gap-2 px-4 pb-4">
        <PrimaryActionButton job={job} h={h} className="h-11 flex-1 text-sm" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn("h-11 rounded-xl", primaryAction(job, h) ? "w-11 px-0" : "flex-1")}
              aria-label={`More actions for ${job.trackingCode}`}
            >
              <MoreHorizontal className="size-5" aria-hidden="true" />
              {primaryAction(job, h) ? null : <span>Actions</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
            <DropdownMenuItem asChild className="min-h-11 cursor-pointer rounded-lg text-[15px]">
              <a href={navigateUrl(job)} target="_blank" rel="noopener noreferrer">
                <Navigation className="size-4" aria-hidden="true" />
                {toPickup ? "Navigate to pickup" : "Navigate"}
              </a>
            </DropdownMenuItem>
            {job.recipientPhone ? (
              <DropdownMenuItem asChild className="min-h-11 cursor-pointer rounded-lg text-[15px]">
                <a href={`tel:${job.recipientPhone}`}>
                  <Phone className="size-4" aria-hidden="true" />
                  Call {job.recipientName}
                </a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="min-h-11 cursor-pointer rounded-lg text-[15px]" onSelect={() => h.onOpenDetail(job)}>
              <Eye className="size-4" aria-hidden="true" />
              View details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="min-h-11 cursor-pointer rounded-lg text-[15px]"
              disabled={busy}
              onSelect={() => h.onOpenReport(job)}
            >
              <AlertTriangle className="size-4" aria-hidden="true" />
              Report problem
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// Hero summary
// ─────────────────────────────────────────────────────────────

export function HeroSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 p-5 text-white sm:p-6",
        "shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_32px_-16px_rgb(4_120_87/0.6)] dark:from-emerald-950 dark:via-emerald-900 dark:to-teal-900 dark:shadow-none dark:ring-1 dark:ring-white/10",
        ENTER_MOTION,
        className,
      )}
    >
      {/* light-mode scrim: lifts white small text to ≥4.5:1 on the emerald-600 / teal-600 stops */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-black/15 dark:hidden" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_100%_0%,rgb(255_255_255/0.18),transparent_55%)]"
        aria-hidden="true"
      />
      {children}
    </section>
  );
}

export function HeroStat({
  label,
  value,
  tone = "default",
  loading,
}: {
  label: string;
  value: number;
  tone?: "default" | "alert";
  loading?: boolean;
}) {
  const alert = tone === "alert" && value > 0;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-2xl px-3 py-3 ring-1 ring-inset sm:px-4",
        // Same glass tile as its neighbours; the alert is a crisp red badge + ring, not a muddy red fill on green.
        "bg-emerald-950/25 dark:bg-white/5",
        alert ? "ring-2 ring-rose-300/80" : "ring-white/15",
      )}
    >
      {loading ? (
        <span className="my-1 block h-7 w-8 animate-pulse rounded-md bg-white/25" aria-hidden="true" />
      ) : (
        <span className="flex items-center gap-2 text-2xl font-semibold tabular-nums leading-9 sm:text-3xl">
          {value}
          {alert ? (
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-rose-500 shadow-sm" aria-hidden="true">
              <AlertTriangle className="size-3.5 text-white" />
            </span>
          ) : null}
        </span>
      )}
      <span className="text-sm leading-tight text-white/90">{label}</span>
      {loading ? <span className="sr-only">Loading {label}</span> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Empty + loading
// ─────────────────────────────────────────────────────────────

export function CaughtUpState() {
  return (
    <div className={cn(CARD_SURFACE, ENTER_MOTION, "flex flex-col items-center px-6 py-12 text-center")}>
      <div className="relative mb-5 size-24" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-primary/10" />
        <span className="absolute inset-3 rounded-full bg-primary/15" />
        <span className="absolute inset-6 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <CheckCircle2 className="size-6" />
        </span>
        <Sparkles className="absolute -top-1 right-0 size-5 text-amber-500" />
        <Coffee className="absolute -bottom-0.5 -left-1 size-5 text-primary/70" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">You&apos;re all caught up</h2>
      <p className="mt-1.5 max-w-xs text-[15px] text-muted-foreground">
        No active jobs right now. New assignments from dispatch will appear here automatically.
      </p>
    </div>
  );
}

export function JobsSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6" aria-busy="true" aria-label="Loading jobs">
      <div className="flex flex-col gap-5">
        <Skeleton className="h-44 w-full rounded-3xl" />
        <div className={cn(CARD_SURFACE, "p-5 sm:p-6")}>
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
          <Skeleton className="mt-5 h-7 w-4/5" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <div className="mt-5 flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="mt-4 h-11 w-full rounded-xl" />
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
          <Skeleton className="mt-2 h-14 w-full rounded-xl" />
        </div>
      </div>
      <div className="@container">
        <Skeleton className="mb-3 h-5 w-24" />
        <div className="grid gap-3 @lg:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={cn(CARD_SURFACE, "p-4")}>
              <div className="flex items-center justify-between">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-7 w-20 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-11 flex-1 rounded-xl" />
                <Skeleton className="size-11 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={cn(CARD_SURFACE, "flex flex-col items-center gap-3 p-8 text-center")} role="alert">
      <span className="flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60">
        <AlertTriangle className="size-6 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      </span>
      <p className="text-[15px] text-muted-foreground">{message}</p>
      <Button variant="outline" className={cn("h-11 rounded-xl", PRESS)} onClick={onRetry}>
        <RefreshCw className="size-4" aria-hidden="true" /> Try again
      </Button>
    </div>
  );
}
