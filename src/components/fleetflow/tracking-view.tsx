"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Clock, Link2Off, Loader2, MapPin, RefreshCw, SearchX, Truck, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { PUBLIC_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatDateTime, friendlyDueDate } from "@/lib/format";
import type { TrackingData } from "@/lib/types";
import { StatusBadge } from "@/components/fleetflow/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const STEPS: { status: string; label: string }[] = [
  { status: "CREATED", label: "Order received" },
  { status: "ASSIGNED", label: "Courier assigned" },
  { status: "PICKED_UP", label: "Picked up" },
  { status: "IN_TRANSIT", label: "On the way" },
  { status: "DELIVERED", label: "Delivered" },
];

const TRACK_EVENT_LABELS: Record<string, string> = {
  CREATED: "Order received",
  ASSIGNED: "Courier assigned",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "On the way",
  DELIVERED: "Delivered",
  FAILED: "Attempt unsuccessful",
  CANCELLED: "Cancelled",
  NOTE: "Update",
  TRACKING_UPDATED: "Update",
  OVERRIDE: "Status updated",
};

type TrackState =
  | { phase: "loading" }
  | { phase: "invalid" }
  | { phase: "revoked" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: TrackingData };

function heroStatusColor(status: string): string {
  if (status === "DELIVERED") return "text-emerald-600";
  if (status === "FAILED") return "text-rose-600";
  if (status === "CANCELLED") return "text-zinc-500";
  return "text-teal-600";
}

function eventDotColor(eventType: string): string {
  if (eventType === "DELIVERED") return "bg-emerald-500";
  if (eventType === "FAILED") return "bg-rose-500";
  return "bg-zinc-300 dark:bg-zinc-600";
}

// ─────────────────────────────────────────────────────────────
// Stepper
// ─────────────────────────────────────────────────────────────

function Stepper({ data }: { data: TrackingData }) {
  const failed = data.status === "FAILED";

  // Where the delivery currently sits on the 5-step journey.
  let current: number;
  if (data.status === "DELIVERED") {
    current = STEPS.length; // everything completed
  } else {
    const found = STEPS.findIndex((s) => s.status === data.status);
    if (found >= 0) {
      current = found;
    } else {
      // FAILED / CANCELLED → last timeline event that matches a step, else 0
      current = 0;
      for (const ev of data.timeline) {
        const idx = STEPS.findIndex((s) => s.status === ev.eventType);
        if (idx >= 0) current = Math.max(current, idx);
      }
    }
  }

  return (
    <div className="flex items-start" aria-label="Delivery progress">
      {STEPS.map((step, i) => {
        const completed = i < current;
        const isCurrent = i === current;
        const failedHere = failed && isCurrent;
        const first = i === 0;
        const last = i === STEPS.length - 1;
        return (
          <Fragment key={step.status}>
            {i > 0 ? (
              <span
                className={cn("mt-[17px] h-0.5 min-w-2 flex-1 rounded-full", i <= current ? "bg-emerald-500" : "bg-border")}
                aria-hidden="true"
              />
            ) : null}
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  failedHere
                    ? "bg-rose-600 text-white"
                    : completed
                      ? "bg-emerald-600 text-white"
                      : isCurrent
                        ? "bg-primary/10 text-primary ring-2 ring-primary"
                        : "bg-muted text-muted-foreground",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {failedHere ? (
                  <X className="size-4" aria-hidden="true" />
                ) : completed ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : isCurrent ? (
                  <span className="relative flex size-2" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                ) : (
                  <span className="text-xs font-semibold">{i + 1}</span>
                )}
              </span>
              <span
                className={cn(
                  "px-0.5 text-center text-xs leading-tight",
                  isCurrent ? "font-semibold text-foreground" : "text-muted-foreground",
                  !first && !last && "hidden sm:block",
                )}
              >
                {failedHere ? "Attempt unsuccessful" : step.label}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ready state
// ─────────────────────────────────────────────────────────────

function TrackingReady({ data }: { data: TrackingData }) {
  const failed = data.status === "FAILED";
  const statusLabel = PUBLIC_STATUS_LABELS[data.status as keyof typeof PUBLIC_STATUS_LABELS] ?? data.status;
  const events = data.timeline.slice().reverse(); // newest first

  return (
    <>
      {/* Hero */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-medium text-muted-foreground">{data.trackingCode}</span>
          <StatusBadge status={data.status} />
        </div>

        <h1 className={cn("mt-3 text-2xl font-semibold tracking-tight", heroStatusColor(data.status))}>{statusLabel}</h1>

        <div className="mt-5 flex flex-col gap-2.5">
          <div className="flex items-start gap-2.5 text-sm">
            <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">{data.recipientName}</span>
          </div>
          <div className="flex items-start gap-2.5 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{data.deliveryAddress}</span>
          </div>
          <div className="flex items-start gap-2.5 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              Expected delivery: <span className="font-medium">{friendlyDueDate(data.expectedAt)}</span>
            </span>
          </div>
        </div>

        {failed ? (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200" role="status">
            Delivery attempt unsuccessful{data.failureReason ? ` — ${data.failureReason}` : ""}. The sender has been notified and
            will contact you to reschedule.
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Created {formatDate(data.createdAt)}</span>
        </div>
      </Card>

      {/* Stepper */}
      <Card className="mt-4 p-5 sm:p-6">
        <Stepper data={data} />
      </Card>

      {/* Timeline */}
      <Card className="mt-4 p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Delivery updates</h2>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No updates yet.</p>
        ) : (
          <ol className="mt-4 max-h-96 overflow-y-auto pr-2 [scrollbar-width:thin]">
            {events.map((ev, i) => (
              <li key={`${ev.timestamp}-${i}`} className="relative border-l pb-5 pl-5 last:border-transparent last:pb-0">
                <span
                  className={cn("absolute -left-[5px] top-1 size-2.5 rounded-full ring-4 ring-card", eventDotColor(ev.eventType))}
                  aria-hidden="true"
                />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{TRACK_EVENT_LABELS[ev.eventType] ?? ev.eventType}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(ev.timestamp)}</span>
                </div>
                {ev.note ? <p className="mt-0.5 break-words text-sm text-muted-foreground">{ev.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Full-screen states
// ─────────────────────────────────────────────────────────────

function StatusCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-8 text-center sm:p-10">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted">{icon}</div>
      <h1 className="mt-4 text-lg font-semibold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{children}</p>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Tracking view — public, standalone (no app shell, no auth)
// ─────────────────────────────────────────────────────────────

export function TrackingView({ token }: { token: string }) {
  const [state, setState] = useState<TrackState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<TrackingData>(`/api/track/${encodeURIComponent(token)}`);
        if (!cancelled) setState({ phase: "ready", data });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiRequestError && e.status === 410) setState({ phase: "revoked" });
        else if (e instanceof ApiRequestError && e.status === 404) setState({ phase: "invalid" });
        else setState({ phase: "error", message: e instanceof Error ? e.message : "Something went wrong. Please try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 w-full max-w-2xl items-center gap-2.5 px-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true">
            <Truck className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">FleetFlow</div>
            <div className="text-xs text-muted-foreground">Shipment tracking</div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        {state.phase === "loading" ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground" aria-busy="true">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm">Checking your delivery…</p>
          </div>
        ) : state.phase === "invalid" ? (
          <StatusCard icon={<SearchX className="size-7 text-amber-500" aria-hidden="true" />} title="Tracking link not recognized">
            Check the link you received and try again, or contact the sender.
          </StatusCard>
        ) : state.phase === "revoked" ? (
          <StatusCard icon={<Link2Off className="size-7 text-rose-500" aria-hidden="true" />} title="This tracking link has been revoked">
            The sender disabled tracking for this delivery. Contact them for an update.
          </StatusCard>
        ) : state.phase === "error" ? (
          <StatusCard icon={<AlertTriangle className="size-7 text-amber-500" aria-hidden="true" />} title="Something went wrong">
            {state.message}
            <span className="mt-4 block">
              <Button variant="outline" className="min-h-11" onClick={() => setAttempt((a) => a + 1)}>
                <RefreshCw className="size-4" aria-hidden="true" /> Try again
              </Button>
            </span>
          </StatusCard>
        ) : (
          <TrackingReady data={state.data} />
        )}
      </main>

      <footer className="mt-auto border-t bg-card">
        <p className="mx-auto w-full max-w-2xl px-4 py-4 text-center text-xs text-muted-foreground">
          Powered by FleetFlow — this page shows delivery status only.
        </p>
      </footer>
    </div>
  );
}

export default TrackingView;
