"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, LocateFixed, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { Delivery } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { GEO_SOURCE_LABELS } from "./delivery-pin-section";
import { externalMapUrl } from "./map-style";
import { MapView } from "./map-view";
import { useMapConfig } from "./use-map-config";

/**
 * Delivery detail: where the delivery goes — a small map, "Open in Maps",
 * who set the point, and Locate (look the address up again) when the point
 * is missing or came from a lookup.
 */
export function DeliveryLocationPanel({ delivery, canLocate }: { delivery: Delivery; canLocate: boolean }) {
  const config = useMapConfig();
  const [locating, setLocating] = useState(false);
  const loc = delivery.location ?? null;
  const showLocate = canLocate && !!config?.geocoding && (!loc || loc.source === "GEOCODED");

  async function locate() {
    setLocating(true);
    try {
      const res = await api.post<{ located: boolean }>(`/api/deliveries/${delivery.id}/locate`);
      if (res.located) toast.success("Location found from the address");
      else toast.info("Couldn't find this address on the map — edit the delivery to drop a pin");
      useAppStore.getState().bump();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden /> Map location
        </p>
        {loc && (
          <Button asChild variant="ghost" size="sm">
            <a href={externalMapUrl(loc.lat, loc.lng)} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden /> Open in Maps
            </a>
          </Button>
        )}
        {showLocate && (
          <Button type="button" variant="outline" size="sm" onClick={locate} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" aria-hidden /> : <LocateFixed aria-hidden />} {loc ? "Locate again" : "Locate"}
          </Button>
        )}
      </div>
      {loc ? (
        <>
          <MapView
            styleUrl={config?.styleUrl}
            className="mt-2 h-40 min-h-40"
            markers={[{ id: delivery.id, kind: "pin", lat: loc.lat, lng: loc.lng, color: "#dc2626", title: delivery.deliveryAddress }]}
            fitKey={`${loc.lat},${loc.lng}`}
            ariaLabel={`Map of ${delivery.deliveryAddress}`}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {(loc.source && GEO_SOURCE_LABELS[loc.source]) || "Located"} · {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">
          Not on the map yet.{" "}
          {config?.geocoding ? "It's looked up from the address automatically" : "Edit the delivery to drop a pin"}.
        </p>
      )}
    </div>
  );
}
