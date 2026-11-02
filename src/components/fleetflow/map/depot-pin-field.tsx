"use client";

import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, MapPin, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import type { LatLng } from "@/lib/geo";
import type { OrgSettings } from "@/lib/types-org";
import { useAppStore } from "@/store/app-store";

const LocationPicker = lazy(() => import("./location-picker").then((m) => ({ default: m.LocationPicker })));

/**
 * Settings → Company: the depot / pickup point on the map (route planning
 * starts here and the live map shows it). Saved on its own, separately from
 * the profile form.
 */
export function DepotPinField({ org, address }: { org: OrgSettings; address: string }) {
  const saved: LatLng | null = org.pickupLat != null && org.pickupLng != null ? { lat: org.pickupLat, lng: org.pickupLng } : null;
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState<LatLng | null>(saved);
  const [saving, setSaving] = useState(false);
  const dirty = pin?.lat !== saved?.lat || pin?.lng !== saved?.lng;

  async function save() {
    setSaving(true);
    try {
      await api.patch("/api/org", { pickupLat: pin?.lat ?? null, pickupLng: pin?.lng ?? null });
      toast.success(pin ? "Pickup point saved" : "Pickup point removed");
      useAppStore.getState().bump("/api/org");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save the pickup point");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border">
      <Button type="button" variant="ghost" className="min-h-11 w-full justify-between px-3 sm:min-h-9" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2">
          <MapPin className="size-4" aria-hidden />
          Pickup point on the map
          <span className="text-xs font-normal text-muted-foreground">{saved ? "· set" : "· not set"}</span>
        </span>
        <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
      </Button>
      {open && (
        <div className="space-y-2 border-t p-3">
          <Suspense fallback={<Skeleton className="h-72 w-full" />}>
            <LocationPicker value={pin} onChange={setPin} initialQuery={address.trim()} />
          </Suspense>
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save pickup point
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
