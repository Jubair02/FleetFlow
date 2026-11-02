"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MapPinOff, Radio } from "lucide-react";
import { ApiRequestError, api, useApiData } from "@/lib/api-client";
import type { OrgPlanInfo } from "@/lib/types-org";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Live location from the driver app (docs/MAPS.md). Shared ONLY while the
// driver holds a picked-up / in-transit job AND the app is open and visible,
// about every 30 s. Stops for good (until the app reloads) when the plan has
// no live map (403) or the driver refuses location permission. The server
// enforces the same rules — this just avoids pointless requests.
// ─────────────────────────────────────────────────────────────

const SEND_EVERY_MS = 30_000;

export type SharingState = "off" | "starting" | "sharing" | "denied" | "unavailable";

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
const isVisible = () => document.visibilityState === "visible";

/** Watch and send the driver's position while `inProgress` (a job is picked up / in transit). */
export function useLocationSharing(inProgress: boolean): SharingState {
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => false);
  // don't even ask for location permission when the plan has no live map
  const plan = useApiData<{ planInfo?: OrgPlanInfo | null }>("/api/org").data?.planInfo;
  const planAllows = !plan || plan.features.includes("live_map");
  const [stopped, setStopped] = useState<"denied" | "unavailable" | null>(null);
  const [sentOnce, setSentOnce] = useState(false);
  const lastSent = useRef(0);
  const inFlight = useRef(false);

  const enabled = inProgress && planAllows && visible && !stopped && typeof navigator !== "undefined" && "geolocation" in navigator;

  useEffect(() => {
    if (!enabled) return;
    const send = async (pos: GeolocationPosition) => {
      const now = Date.now();
      if (inFlight.current || now - lastSent.current < SEND_EVERY_MS) return;
      inFlight.current = true;
      lastSent.current = now;
      const c = pos.coords;
      try {
        await api.post("/api/driver/location", {
          lat: c.latitude,
          lng: c.longitude,
          accuracy: Number.isFinite(c.accuracy) ? Math.min(c.accuracy, 100_000) : null,
          heading: c.heading != null && Number.isFinite(c.heading) ? c.heading : null,
          speedKmh: c.speed != null && Number.isFinite(c.speed) ? Math.min(c.speed * 3.6, 300) : null,
          recordedAt: new Date(pos.timestamp || now).toISOString(),
        });
        setSentOnce(true);
      } catch (e) {
        // 403: the plan has no live map → stop. 409 (no job in progress) / 429 / network: try again later.
        if (e instanceof ApiRequestError && e.status === 403) setStopped("unavailable");
      } finally {
        inFlight.current = false;
      }
    };
    const id = navigator.geolocation.watchPosition(
      (pos) => void send(pos),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setStopped("denied");
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 60_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  if (!inProgress || !planAllows) return "off";
  if (stopped) return stopped;
  return sentOnce ? "sharing" : "starting";
}

/** Small banner so the driver always knows when dispatch can see them. */
export function LocationSharingIndicator({ state, className }: { state: SharingState; className?: string }) {
  if (state === "off" || state === "unavailable") return null;
  const denied = state === "denied";
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
        denied
          ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        className
      )}
    >
      {denied ? <MapPinOff className="size-4 shrink-0" aria-hidden /> : <Radio className="size-4 shrink-0 animate-pulse" aria-hidden />}
      <span>
        {denied
          ? "Location is off — dispatch and your customer can't see you approaching. Allow location for FleetFlow to share it."
          : state === "starting"
            ? "Starting location sharing with dispatch…"
            : "Sharing location with dispatch while this delivery is in progress"}
      </span>
    </div>
  );
}
