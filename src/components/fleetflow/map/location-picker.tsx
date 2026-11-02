"use client";

import { useEffect, useState } from "react";
import { Loader2, LocateFixed, MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { roundCoord, type LatLng } from "@/lib/geo";
import type { PlaceResult } from "@/lib/map-types";
import { MapView } from "./map-view";
import { useMapConfig } from "./use-map-config";

// ─────────────────────────────────────────────────────────────
// <LocationPicker> — choose a point: search an address (Barikoi, through
// GET /api/maps/search so the key stays on the server), tap the map, or
// drag the pin. Used for a delivery's drop-off and the company depot.
// ─────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 350;

export function LocationPicker({
  value,
  onChange,
  initialQuery = "",
  className,
}: {
  value: LatLng | null;
  onChange: (point: LatLng | null) => void;
  /** Pre-fills the search (e.g. the address typed in the form). */
  initialQuery?: string;
  className?: string;
}) {
  const config = useMapConfig();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [focus, setFocus] = useState<(LatLng & { key: number }) | null>(null);
  const [locating, setLocating] = useState(false);

  const canSearch = !!config?.geocoding;
  const q = query.trim();

  useEffect(() => {
    if (!canSearch || q.length < 3) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ results: PlaceResult[] }>(`/api/maps/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) {
          setResults(res.results);
          setSearchError(null);
        }
      } catch (e) {
        if (!cancelled) setSearchError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, canSearch]);

  const pick = (p: LatLng, fly = false) => {
    const point = { lat: roundCoord(p.lat), lng: roundCoord(p.lng) };
    onChange(point);
    if (fly) setFocus((prev) => ({ ...point, key: (prev?.key ?? 0) + 1 }));
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pick({ lat: pos.coords.latitude, lng: pos.coords.longitude }, true);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  };

  const shownResults = canSearch && q.length >= 3 ? results : [];

  return (
    <div className={className}>
      {canSearch && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search an address or place"
            aria-label="Search an address on the map"
            className="min-h-11 pl-8 sm:min-h-9"
          />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
          {shownResults.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md" role="listbox" aria-label="Address suggestions">
              {shownResults.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="w-full rounded px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    onClick={() => {
                      pick(r, true);
                      setResults([]);
                      setQuery(r.address);
                    }}
                  >
                    <span className="block">{r.address}</span>
                    {(r.area || r.city) && <span className="block text-xs text-muted-foreground">{[r.area, r.city].filter(Boolean).join(", ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchError && <p className="mt-1 text-xs text-destructive">{searchError}</p>}
        </div>
      )}
      <MapView
        styleUrl={config?.styleUrl}
        className="h-64"
        markers={value ? [{ id: "pin", kind: "pin", lat: value.lat, lng: value.lng, color: "#dc2626", draggable: true, title: "Drag to adjust" }] : []}
        fitKey="initial"
        focus={focus}
        onMapClick={(p) => pick(p)}
        onMarkerDrag={(_id, p) => pick(p)}
        ariaLabel="Map — tap to place the pin"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="size-3.5" aria-hidden />
        <span className="mr-auto">{value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : "Tap the map to drop a pin"}</span>
        <Button type="button" variant="ghost" size="sm" onClick={useMyLocation} disabled={locating}>
          {locating ? <Loader2 className="animate-spin" aria-hidden /> : <LocateFixed aria-hidden />} My location
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X aria-hidden /> Remove pin
          </Button>
        )}
      </div>
    </div>
  );
}
