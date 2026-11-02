"use client";

import { lazy, Suspense, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LatLng } from "@/lib/geo";
import type { Delivery } from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// "Pin on map" section of the delivery create/edit form. The pin is
// optional: without one the server looks the address up (Barikoi). A pin
// is stored as geoSource PIN and is never replaced by a lookup.
// The picker (and the map library) loads only when the section is opened.
// ─────────────────────────────────────────────────────────────

const LocationPicker = lazy(() => import("./location-picker").then((m) => ({ default: m.LocationPicker })));

export const GEO_SOURCE_LABELS: Record<string, string> = {
  PIN: "Pinned by staff",
  GEOCODED: "Found from the address",
  DRIVER: "From the driver's GPS",
  API: "Sent by your integration",
};

/** The form's pin state: the point as loaded (or null) and whatever the user chose since. */
export function initialPin(delivery: Delivery | null): LatLng | null {
  const loc = delivery?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

/**
 * Request fields for the pin. Create: only when one was dropped. Edit: only
 * when it changed — a new point (→ PIN) or null to remove it (the address is
 * looked up again).
 */
export function pinFields(pin: LatLng | null, original: LatLng | null): { deliveryLat?: number | null; deliveryLng?: number | null } {
  if (pin?.lat === original?.lat && pin?.lng === original?.lng) return {};
  return { deliveryLat: pin?.lat ?? null, deliveryLng: pin?.lng ?? null };
}

export function DeliveryPinSection({
  value,
  onChange,
  address,
  source,
}: {
  value: LatLng | null;
  onChange: (pin: LatLng | null) => void;
  /** The typed delivery address (pre-fills the map search). */
  address: string;
  /** geoSource of the saved point, when editing. */
  source?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const status = value
    ? source && GEO_SOURCE_LABELS[source]
      ? GEO_SOURCE_LABELS[source]
      : "Pinned"
    : "Not pinned — we'll find it from the address";

  return (
    <div className="rounded-md border">
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 w-full justify-between px-3 sm:min-h-9"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <MapPin className="size-4" aria-hidden />
          Pin on map <span className="text-xs font-normal text-muted-foreground">(optional) · {status}</span>
        </span>
        <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
      </Button>
      {open && (
        <div className="border-t p-3">
          <Suspense fallback={<Skeleton className="h-72 w-full" />}>
            <LocationPicker value={value} onChange={onChange} initialQuery={address.trim()} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
