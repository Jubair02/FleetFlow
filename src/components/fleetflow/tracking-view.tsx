"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Link2Off, Phone, RefreshCw, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackingData } from "@/lib/tracking";
import { Button } from "@/components/ui/button";
import { LANG_COOKIE, LANG_STORAGE_KEY, isLang, type Lang } from "@/components/fleetflow/tracking/i18n";
import { codDue, createTrackingFormat, isFinalStatus, telHref, type TrackingFormat } from "@/components/fleetflow/tracking/tracking-model";
import { CodDue, LiveStatus, TrackingHero } from "@/components/fleetflow/tracking/tracking-hero";
import { TrackingProgress } from "@/components/fleetflow/tracking/tracking-progress";
import { TrackingDetails, TrackingTimeline } from "@/components/fleetflow/tracking/tracking-sections";
import { PAGE_WIDTH, StatusCard, TrackingFooter, TrackingHeader, TrackingSkeleton } from "@/components/fleetflow/tracking/tracking-ui";
import { BrandMessage, RatingCard, RescheduleCard } from "@/components/fleetflow/tracking/tracking-feedback";
import { brandCssVars } from "@/lib/branding";
import { TrackingLiveMap } from "@/components/fleetflow/tracking/tracking-live-map";

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

type Sender = TrackingData["sender"];

/** What the server found when it rendered the page (see src/app/track/[token]/page.tsx). */
export type TrackingInitialState =
  | { phase: "invalid" }
  | { phase: "revoked" }
  | { phase: "error" }
  | { phase: "ready"; data: TrackingData };

type TrackState =
  | { phase: "loading" }
  | { phase: "invalid" }
  // `sender` is only known when the link was revoked while this page was open.
  | { phase: "revoked"; sender?: Sender }
  | { phase: "error" }
  | { phase: "ready"; data: TrackingData };

/** Fetch error carrying the HTTP status (410 = revoked, 404 = unknown link). */
class TrackFetchError extends Error {
  constructor(readonly status: number) {
    super(`Tracking request failed (${status})`);
  }
}

/**
 * Plain fetch on purpose — the shared api-client pulls in the admin app store,
 * which the public page must not ship.
 */
async function fetchTracking(token: string): Promise<TrackingData> {
  const res = await fetch(`/api/track/${encodeURIComponent(token)}`, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!res.ok) throw new TrackFetchError(res.status);
  return (await res.json()) as TrackingData;
}

/** Silent refresh cadence while the delivery can still change. */
const REFRESH_MS = 60_000;
/** How often the "Updated x ago" / "12 min ago" labels re-render. */
const CLOCK_MS = 30_000;

/** Remember the visitor's language: localStorage + a cookie the server reads on the next visit. */
function saveLang(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* storage blocked (private mode) — the choice just isn't remembered */
  }
  try {
    document.cookie = `${LANG_COOKIE}=${lang}; path=/track; max-age=31536000; samesite=lax`;
  } catch {
    /* ignore */
  }
}

function readSavedLang(): Lang | null {
  try {
    const v = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Ready state
// ─────────────────────────────────────────────────────────────

function TrackingReady({
  token,
  data,
  now,
  updatedAt,
  refreshing,
  refreshFailed,
  onRefresh,
  f,
}: {
  token: string;
  data: TrackingData;
  now: number;
  updatedAt: number;
  refreshing: boolean;
  refreshFailed: boolean;
  onRefresh: () => void;
  f: TrackingFormat;
}) {
  const live = !isFinalStatus(data.status);
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6">
      <div className="flex flex-col gap-4">
        <TrackingHero data={data} now={now} f={f} />
        {live ? (
          <LiveStatus updatedAt={updatedAt} now={now} refreshing={refreshing} refreshFailed={refreshFailed} onRefresh={onRefresh} f={f} />
        ) : null}
        {/* courier on the map + ETA while on the way (renders nothing otherwise) */}
        <TrackingLiveMap token={token} status={data.status} f={f} />
        <BrandMessage data={data} f={f} />
        <RatingCard token={token} data={data} f={f} onSent={onRefresh} />
        <RescheduleCard token={token} data={data} now={now} f={f} onSent={onRefresh} />
        {codDue(data) && data.codAmount ? <CodDue amount={data.codAmount} f={f} /> : null}
        <TrackingProgress data={data} now={now} f={f} />
        <TrackingDetails data={data} f={f} />
      </div>
      <div className="mt-4 lg:mt-0">
        <TrackingTimeline data={data} now={now} f={f} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tracking view — public, standalone (no app shell, no auth).
// Server-rendered from `initial`, then kept fresh by polling the API.
// ─────────────────────────────────────────────────────────────

export function TrackingView({
  token,
  initial,
  initialNow,
  initialLang,
  langFromUrl,
}: {
  token: string;
  initial: TrackingInitialState;
  /** Server render time — the first paint uses it so server and client markup match. */
  initialNow: number;
  initialLang: Lang;
  /** ?lang= was in the URL: it wins over a remembered choice. */
  langFromUrl: boolean;
}) {
  const [state, setState] = useState<TrackState>(initial);
  const [attempt, setAttempt] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(initialNow);
  const [now, setNow] = useState(initialNow);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [lang, setLang] = useState<Lang>(initialLang);

  const alive = useRef(true);
  const inFlight = useRef(false);
  const lastData = useRef<TrackingData | null>(initial.phase === "ready" ? initial.data : null);

  const timeZone = state.phase === "ready" ? state.data.timezone : null;
  const f = useMemo(() => createTrackingFormat(lang, timeZone), [lang, timeZone]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A choice remembered in localStorage (e.g. the cookie was cleared) — applied after mount.
  useEffect(() => {
    if (langFromUrl) return;
    const saved = readSavedLang();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    if (saved && saved !== initialLang) setLang(saved);
  }, [langFromUrl, initialLang]);

  const changeLang = useCallback((next: Lang) => {
    setLang(next);
    saveLang(next);
    // Keep a shared ?lang= link in step with the choice.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.set("lang", next);
        window.history.replaceState(window.history.state, "", url);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // "Try again" after an error (the first load comes from the server).
  useEffect(() => {
    if (attempt === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTracking(token);
        if (cancelled) return;
        const t = Date.now();
        lastData.current = data;
        setState({ phase: "ready", data });
        setUpdatedAt(t);
        setNow(t);
        setRefreshFailed(false);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof TrackFetchError && e.status === 410) setState({ phase: "revoked" });
        else if (e instanceof TrackFetchError && e.status === 404) setState({ phase: "invalid" });
        else setState({ phase: "error" });
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
      const data = await fetchTracking(token);
      if (!alive.current) return;
      const t = Date.now();
      lastData.current = data;
      setState({ phase: "ready", data });
      setUpdatedAt(t);
      setNow(t);
      setRefreshFailed(false);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof TrackFetchError && e.status === 410) setState({ phase: "revoked", sender: lastData.current?.sender });
      else if (e instanceof TrackFetchError && e.status === 404) setState({ phase: "invalid" });
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

  const senderName = state.phase === "ready" ? state.data.sender.name : state.phase === "revoked" ? (state.sender?.name ?? null) : null;
  const { t } = f;
  // Branding (plan-checked on the server): accent colour as CSS variables, logo in the header.
  const branding = state.phase === "ready" ? state.data.branding : null;
  const brandStyle = useMemo(() => brandCssVars(branding?.color) as React.CSSProperties | undefined, [branding?.color]);

  const retry = () => {
    setState({ phase: "loading" });
    setAttempt((a) => a + 1);
  };

  return (
    <div lang={lang} style={brandStyle} className="relative flex min-h-dvh flex-col overflow-x-clip bg-muted/40 dark:bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(16_185_129/0.10),transparent)] dark:bg-[radial-gradient(60%_100%_at_50%_0%,rgb(16_185_129/0.08),transparent)]"
        aria-hidden="true"
      />
      <TrackingHeader
        senderName={senderName}
        loading={state.phase === "loading"}
        f={f}
        onLanguageChange={changeLang}
        logoUrl={branding?.logoUrl}
        branded={!!branding?.color}
      />

      <main className={cn(PAGE_WIDTH, "relative flex-1 py-6 sm:py-8")}>
        {state.phase === "loading" ? (
          <TrackingSkeleton f={f} />
        ) : state.phase === "invalid" ? (
          <StatusCard tone="amber" icon={<SearchX className="size-7" aria-hidden="true" />} title={t.invalidTitle} steps={[t.invalidStep1, t.invalidStep2]} f={f}>
            {t.invalidBody}
          </StatusCard>
        ) : state.phase === "revoked" ? (
          <StatusCard
            tone="slate"
            icon={<Link2Off className="size-7" aria-hidden="true" />}
            title={t.revokedTitle}
            steps={[state.sender ? t.revokedStep1Named(state.sender.name) : t.revokedStep1, t.revokedStep2]}
            f={f}
            action={
              state.sender?.phone ? (
                <Button asChild className="h-12 w-full max-w-xs min-w-0 rounded-xl bg-emerald-700 text-[15px] text-white hover:bg-emerald-800 dark:bg-emerald-700 dark:hover:bg-emerald-600">
                  <a href={telHref(state.sender.phone)}>
                    <Phone className="size-4" aria-hidden="true" />
                    <span className="truncate">{t.callSender(state.sender.name)}</span>
                  </a>
                </Button>
              ) : undefined
            }
          >
            {state.sender ? t.revokedBodyNamed(state.sender.name) : t.revokedBody}
          </StatusCard>
        ) : state.phase === "error" ? (
          <StatusCard
            tone="amber"
            icon={<AlertTriangle className="size-7" aria-hidden="true" />}
            title={t.errorTitle}
            steps={[t.errorStep1, t.errorStep2]}
            f={f}
            action={
              <Button variant="outline" className="min-h-11 rounded-xl px-5" onClick={retry}>
                <RefreshCw className="size-4" aria-hidden="true" /> {t.tryAgain}
              </Button>
            }
          >
            {t.errorBody}
          </StatusCard>
        ) : (
          <TrackingReady
            token={token}
            data={state.data}
            now={now}
            updatedAt={updatedAt}
            refreshing={refreshing}
            refreshFailed={refreshFailed}
            onRefresh={() => void refresh()}
            f={f}
          />
        )}
      </main>

      <TrackingFooter f={f} />
    </div>
  );
}

export default TrackingView;
