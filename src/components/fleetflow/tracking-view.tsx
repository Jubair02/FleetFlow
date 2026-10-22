"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Link2Off, Phone, RefreshCw, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import type { TrackingData } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { isFinalStatus, telHref } from "@/components/fleetflow/tracking/tracking-model";
import { LiveStatus, TrackingHero } from "@/components/fleetflow/tracking/tracking-hero";
import { TrackingProgress } from "@/components/fleetflow/tracking/tracking-progress";
import { TrackingDetails, TrackingTimeline } from "@/components/fleetflow/tracking/tracking-sections";
import { PAGE_WIDTH, StatusCard, TrackingFooter, TrackingHeader, TrackingSkeleton } from "@/components/fleetflow/tracking/tracking-ui";

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

type Sender = TrackingData["sender"];

type TrackState =
  | { phase: "loading" }
  | { phase: "invalid" }
  // `sender` is only known when the link was revoked while this page was open.
  | { phase: "revoked"; sender?: Sender }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: TrackingData };

/** Silent refresh cadence while the delivery can still change. */
const REFRESH_MS = 60_000;
/** How often the "Updated x ago" / "12 min ago" labels re-render. */
const CLOCK_MS = 30_000;

// ─────────────────────────────────────────────────────────────
// Ready state
// ─────────────────────────────────────────────────────────────

function TrackingReady({
  data,
  now,
  updatedAt,
  refreshing,
  refreshFailed,
  onRefresh,
}: {
  data: TrackingData;
  now: number;
  updatedAt: number;
  refreshing: boolean;
  refreshFailed: boolean;
  onRefresh: () => void;
}) {
  const live = !isFinalStatus(data.status);
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6">
      <div className="flex flex-col gap-4">
        <TrackingHero data={data} now={now} />
        {live ? (
          <LiveStatus updatedAt={updatedAt} now={now} refreshing={refreshing} refreshFailed={refreshFailed} onRefresh={onRefresh} />
        ) : null}
        <TrackingProgress data={data} now={now} />
        <TrackingDetails data={data} />
      </div>
      <div className="mt-4 lg:mt-0">
        <TrackingTimeline data={data} now={now} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tracking view — public, standalone (no app shell, no auth)
// ─────────────────────────────────────────────────────────────

export function TrackingView({ token }: { token: string }) {
  const [state, setState] = useState<TrackState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const alive = useRef(true);
  const inFlight = useRef(false);
  const lastData = useRef<TrackingData | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Initial load (and "Try again").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<TrackingData>(`/api/track/${encodeURIComponent(token)}`);
        if (cancelled) return;
        const t = Date.now();
        lastData.current = data;
        setState({ phase: "ready", data });
        setUpdatedAt(t);
        setNow(t);
        setRefreshFailed(false);
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

  // Silent refresh: keeps the current page on screen, never flashes to a spinner.
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const data = await apiFetch<TrackingData>(`/api/track/${encodeURIComponent(token)}`);
      if (!alive.current) return;
      const t = Date.now();
      lastData.current = data;
      setState({ phase: "ready", data });
      setUpdatedAt(t);
      setNow(t);
      setRefreshFailed(false);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiRequestError && e.status === 410) setState({ phase: "revoked", sender: lastData.current?.sender });
      else if (e instanceof ApiRequestError && e.status === 404) setState({ phase: "invalid" });
      else setRefreshFailed(true); // keep showing the last good data
    } finally {
      inFlight.current = false;
      if (alive.current) setRefreshing(false);
    }
  }, [token]);

  const readyStatus = state.phase === "ready" ? state.data.status : null;
  const live = readyStatus !== null && !isFinalStatus(readyStatus);

  // Poll every 60s while the delivery can still change; pause while the tab is hidden.
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastFetch = Date.now();
    const tick = () => {
      lastFetch = Date.now();
      void refresh();
    };
    const start = () => {
      if (timer === undefined) timer = setInterval(tick, REFRESH_MS);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Coming back after a while: catch up immediately, then resume the cadence.
        if (Date.now() - lastFetch >= REFRESH_MS) tick();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [live, refresh]);

  // Keep relative labels ("Updated 3 min ago", "12 min ago") fresh.
  const hasData = state.phase === "ready";
  useEffect(() => {
    if (!hasData) return;
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, CLOCK_MS);
    return () => clearInterval(id);
  }, [hasData]);

  // Name the browser tab after the shipment and its sender once loaded.
  const loadedCode = state.phase === "ready" ? state.data.trackingCode : null;
  const senderName = state.phase === "ready" ? state.data.sender.name : state.phase === "revoked" ? (state.sender?.name ?? null) : null;
  useEffect(() => {
    if (!loadedCode) return;
    const previous = document.title;
    document.title = senderName ? `Tracking ${loadedCode} — ${senderName}` : `Tracking ${loadedCode}`;
    return () => {
      document.title = previous;
    };
  }, [loadedCode, senderName]);

  const retry = () => {
    setState({ phase: "loading" });
    setAttempt((a) => a + 1);
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-muted/40 dark:bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(16_185_129/0.10),transparent)] dark:bg-[radial-gradient(60%_100%_at_50%_0%,rgb(16_185_129/0.08),transparent)]"
        aria-hidden="true"
      />
      <TrackingHeader senderName={senderName} loading={state.phase === "loading"} />

      <main className={cn(PAGE_WIDTH, "relative flex-1 py-6 sm:py-8")}>
        {state.phase === "loading" ? (
          <TrackingSkeleton />
        ) : state.phase === "invalid" ? (
          <StatusCard
            tone="amber"
            icon={<SearchX className="size-7" aria-hidden="true" />}
            title="Tracking link not recognized"
            steps={["Open the full link from the SMS or message you received — part of it may be missing.", "Still not working? Contact the sender and ask them to resend your tracking link."]}
          >
            Check the link you received and try again, or contact the sender.
          </StatusCard>
        ) : state.phase === "revoked" ? (
          <StatusCard
            tone="slate"
            icon={<Link2Off className="size-7" aria-hidden="true" />}
            title="This tracking link has been revoked"
            steps={[
              state.sender ? `Contact ${state.sender.name} for an update on your delivery.` : "Contact the sender for an update on your delivery.",
              "Ask them for a new tracking link if you'd like to keep following it here.",
            ]}
            action={
              state.sender?.phone ? (
                <Button asChild className="h-12 w-full max-w-xs min-w-0 rounded-xl bg-emerald-700 text-[15px] text-white hover:bg-emerald-800 dark:bg-emerald-700 dark:hover:bg-emerald-600">
                  <a href={telHref(state.sender.phone)}>
                    <Phone className="size-4" aria-hidden="true" />
                    <span className="truncate">Call {state.sender.name}</span>
                  </a>
                </Button>
              ) : undefined
            }
          >
            {state.sender
              ? `${state.sender.name} disabled tracking for this delivery. Contact them for an update.`
              : "The sender disabled tracking for this delivery. Contact them for an update."}
          </StatusCard>
        ) : state.phase === "error" ? (
          <StatusCard
            tone="amber"
            icon={<AlertTriangle className="size-7" aria-hidden="true" />}
            title="Something went wrong"
            steps={["Check your internet connection, then try again.", "If the problem continues, try again in a few minutes."]}
            action={
              <Button variant="outline" className="min-h-11 rounded-xl px-5" onClick={retry}>
                <RefreshCw className="size-4" aria-hidden="true" /> Try again
              </Button>
            }
          >
            {state.message}
          </StatusCard>
        ) : (
          <TrackingReady
            data={state.data}
            now={now}
            updatedAt={updatedAt}
            refreshing={refreshing}
            refreshFailed={refreshFailed}
            onRefresh={() => void refresh()}
          />
        )}
      </main>

      <TrackingFooter />
    </div>
  );
}

export default TrackingView;
