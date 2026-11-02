"use client";

import { useEffect, useState } from "react";
import { Navigation } from "lucide-react";
import type { TrackingLive } from "@/lib/map-types";
import { MapView } from "@/components/fleetflow/map/map-view";
import { DRIVER_COLOR } from "@/components/fleetflow/map/map-style";
import type { TrackingFormat } from "./tracking-model";

// ─────────────────────────────────────────────────────────────
// Customer tracking: the courier approaching on a map with an ETA, only
// while the parcel is picked up / in transit and the sender's plan has the
// live map (GET /api/track/[token]/live answers {} otherwise, and this
// renders nothing). Polls every 30 s while the page is visible. Never shows
// who the courier is — only where.
// ─────────────────────────────────────────────────────────────

const POLL_MS = 30_000;
const LIVE_STATUSES = new Set(["PICKED_UP", "IN_TRANSIT"]);

export function TrackingLiveMap({ token, status, f }: { token: string; status: string; f: TrackingFormat }) {
  const [live, setLive] = useState<TrackingLive | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const active = LIVE_STATUSES.has(status);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(token)}/live`, { cache: "no-store", headers: { Accept: "application/json" } });
        const body = res.ok ? ((await res.json()) as TrackingLive) : null;
        if (!cancelled && body) {
          setLive(body);
          setNow(Date.now());
        }
      } catch {
        /* keep the last position; the next poll tries again */
      }
    };
    void load();
    const id = window.setInterval(load, POLL_MS);
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, token]);

  const driver = active ? live?.driver : undefined;
  if (!driver) return null;

  const { t } = f;
  const dest = live?.destination ?? null;
  const agoMin = Math.max(0, Math.round((now - new Date(driver.recordedAt).getTime()) / 60_000));
  const ago = agoMin < 1 ? t.liveJustNow : t.liveMinutesAgo(agoMin);
  const eta = live?.etaMinutes;

  return (
    <section aria-labelledby="live-courier-title" className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Navigation className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="live-courier-title" className="font-semibold">{t.liveTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {eta != null ? t.liveEta(eta) : t.liveEtaUnknown} · {t.liveUpdated(ago)}
          </p>
        </div>
      </div>
      <MapView
        styleUrl={live?.styleUrl}
        className="h-56"
        markers={[
          { id: "courier", kind: "driver", lat: driver.lat, lng: driver.lng, color: DRIVER_COLOR, label: "🛵", title: t.liveCourier },
          ...(dest ? [{ id: "dest", kind: "pin" as const, lat: dest.lat, lng: dest.lng, color: "#dc2626", title: t.liveDestination }] : []),
        ]}
        line={dest ? [driver, dest] : null}
        fitKey={dest ? "both" : "courier"}
        ariaLabel={t.liveMapLabel}
      />
      <p className="mt-2 text-xs text-muted-foreground">{t.liveNote}</p>
    </section>
  );
}
