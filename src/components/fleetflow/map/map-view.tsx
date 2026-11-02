"use client";

import { Component, lazy, Suspense, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { MapPinOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { LatLng } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { resolveMapStyle } from "./map-style";

// ─────────────────────────────────────────────────────────────
// <MapView> — the reusable map. The MapLibre code (map-canvas.tsx, plus
// maplibre-gl and its CSS) downloads on first use only. docs/MAPS.md.
//
// styleUrl: from GET /api/maps/config (useMapConfig) in the app, or from
// the tracking API on the public page; null draws OpenStreetMap tiles.
// Nothing here touches the app's API client, so the public tracking page
// can use it too.
// ─────────────────────────────────────────────────────────────

export interface MapMarker extends LatLng {
  id: string;
  /** delivery = status dot, driver = badge with initials (label), depot = square, pin = the picker's pin. */
  kind: "delivery" | "driver" | "depot" | "pin";
  color?: string;
  /** Short text inside the marker (stop number, initials). */
  label?: string;
  /** Tooltip / accessible name. */
  title?: string;
  selected?: boolean;
  clickable?: boolean;
  draggable?: boolean;
}

export interface MapCanvasProps {
  markers: MapMarker[];
  /** Polyline through these points (e.g. a driver's stops in route order). */
  line?: LatLng[] | null;
  lineColor?: string;
  /** Fit the map to the markers + line whenever this value changes. */
  fitKey?: string | number;
  /** Fly to this point when it changes (key forces a repeat). */
  focus?: (LatLng & { zoom?: number; key?: number }) | null;
  onMarkerClick?: (id: string) => void;
  onMarkerDrag?: (id: string, point: LatLng) => void;
  onMapClick?: (point: LatLng) => void;
  className?: string;
  ariaLabel?: string;
}

export interface MapViewProps extends MapCanvasProps {
  styleUrl: string | null | undefined;
}

const MapCanvas = lazy(() => import("./map-canvas"));

/** WebGL missing, or the map chunk couldn't download — show a quiet placeholder instead of breaking the screen. */
class MapErrorBoundary extends Component<{ children: ReactNode; className?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted/40 p-4 text-center text-sm text-muted-foreground", this.props.className)}>
        <MapPinOff className="size-5" aria-hidden />
        The map couldn&apos;t be shown on this device.
      </div>
    );
  }
}

export function MapView({ styleUrl, className, ...props }: MapViewProps) {
  const { resolvedTheme } = useTheme();
  const style = resolveMapStyle(styleUrl, resolvedTheme === "dark");
  const box = cn("relative min-h-48 w-full overflow-hidden rounded-lg border bg-muted", className);
  return (
    <MapErrorBoundary className={box}>
      <Suspense fallback={<Skeleton className={box} />}>
        <MapCanvas {...props} style={style} className={box} />
      </Suspense>
    </MapErrorBoundary>
  );
}
