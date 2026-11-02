"use client";

// The MapLibre GL map itself. Loaded ONLY through map-view.tsx (React.lazy),
// so maplibre-gl and its stylesheet live in their own chunk and never in the
// main bundle or a screen that doesn't show a map.

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng } from "@/lib/geo";
import { DEFAULT_CENTER, DEFAULT_ZOOM, DEPOT_COLOR, DRIVER_COLOR } from "./map-style";
import type { MapCanvasProps, MapMarker } from "./map-view";

const LINE_SOURCE = "ff-route";
const LINE_LAYER = "ff-route-line";

/** Marker element: a coloured dot (optionally numbered), a driver badge or the depot square. */
function paintMarker(el: HTMLElement, m: MapMarker) {
  const color = m.color ?? (m.kind === "driver" ? DRIVER_COLOR : m.kind === "depot" ? DEPOT_COLOR : "#2563eb");
  const size = m.kind === "driver" ? 30 : m.kind === "depot" ? 26 : m.label ? 24 : m.kind === "pin" ? 22 : 16;
  el.className = "ff-map-marker";
  el.title = m.title ?? "";
  el.setAttribute("aria-label", m.title ?? m.label ?? m.kind);
  el.setAttribute("role", m.clickable ? "button" : "img");
  el.tabIndex = m.clickable ? 0 : -1;
  el.textContent = m.kind === "depot" ? "D" : m.kind === "driver" ? (m.label ?? "").slice(0, 2).toUpperCase() : (m.label ?? "");
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    background: color,
    color: "#fff",
    border: `${m.selected ? 3 : 2}px solid ${m.selected ? "#facc15" : "#fff"}`,
    borderRadius: m.kind === "depot" ? "6px" : "9999px",
    boxShadow: "0 1px 4px rgba(0,0,0,.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 11px/1 system-ui, sans-serif",
    cursor: m.clickable || m.draggable ? "pointer" : "default",
    zIndex: m.kind === "driver" ? "3" : m.selected ? "2" : "1",
  } satisfies Partial<CSSStyleDeclaration>);
}

function boundsOf(points: LatLng[]): maplibregl.LngLatBounds | null {
  if (points.length === 0) return null;
  const b = new maplibregl.LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat]);
  for (const p of points) b.extend([p.lng, p.lat]);
  return b;
}

export default function MapCanvas({
  style,
  markers,
  line,
  lineColor = "#0f766e",
  fitKey,
  focus,
  onMarkerClick,
  onMarkerDrag,
  onMapClick,
  className,
  ariaLabel,
}: MapCanvasProps & { style: string | StyleSpecification }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef(new Map<string, maplibregl.Marker>());
  const handlers = useRef({ onMarkerClick, onMarkerDrag, onMapClick });
  const latest = useRef({ markers, line, lineColor });

  useEffect(() => {
    handlers.current = { onMarkerClick, onMarkerDrag, onMapClick };
    latest.current = { markers, line, lineColor };
  });

  // ── create once ──
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style,
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("click", (e) => handlers.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    // (re)draw the route line whenever a style finishes loading
    map.on("style.load", () => drawLine(map, latest.current.line, latest.current.lineColor));
    mapRef.current = map;
    const refs = markerRefs.current;
    return () => {
      refs.forEach((mk) => mk.remove());
      refs.clear();
      map.remove();
      mapRef.current = null;
    };
    // The style is applied by the effect below; recreating the map on every change would flash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── style (light/dark, provider) ──
  const styleKey = typeof style === "string" ? style : "osm";
  const appliedStyle = useRef(styleKey);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyle.current === styleKey) return;
    appliedStyle.current = styleKey;
    map.setStyle(style);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the URL, not the object identity
  }, [styleKey]);

  // ── markers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const refs = markerRefs.current;
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.id);
      let mk = refs.get(m.id);
      if (mk && mk.isDraggable() !== !!m.draggable) {
        mk.remove();
        refs.delete(m.id);
        mk = undefined;
      }
      if (!mk) {
        const el = document.createElement("div");
        const id = m.id;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          handlers.current.onMarkerClick?.(id);
        });
        el.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            handlers.current.onMarkerClick?.(id);
          }
        });
        mk = new maplibregl.Marker({ element: el, draggable: !!m.draggable }).setLngLat([m.lng, m.lat]).addTo(map);
        if (m.draggable) {
          const marker = mk;
          marker.on("dragend", () => {
            const p = marker.getLngLat();
            handlers.current.onMarkerDrag?.(id, { lat: p.lat, lng: p.lng });
          });
        }
        refs.set(m.id, mk);
      } else {
        mk.setLngLat([m.lng, m.lat]);
      }
      paintMarker(mk.getElement(), m);
    }
    for (const [id, mk] of refs) {
      if (!seen.has(id)) {
        mk.remove();
        refs.delete(id);
      }
    }
  }, [markers]);

  // ── line ──
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) drawLine(map, line, lineColor);
  }, [line, lineColor]);

  // ── fit to what's shown when fitKey changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points: LatLng[] = [...latest.current.markers, ...(latest.current.line ?? [])];
    const b = boundsOf(points);
    if (!b) return;
    if (points.length === 1) map.jumpTo({ center: b.getCenter(), zoom: Math.max(map.getZoom(), 14) });
    else map.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 });
  }, [fitKey]);

  // ── fly to a chosen point (search result, "my location") ──
  const focusKey = focus ? `${focus.lat},${focus.lng},${focus.key ?? ""}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 16, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the point itself
  }, [focusKey]);

  return <div ref={container} className={className} role="region" aria-label={ariaLabel ?? "Map"} />;
}

function drawLine(map: maplibregl.Map, line: LatLng[] | null | undefined, color: string) {
  const data: GeoJSON.Feature<GeoJSON.LineString> = {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: (line ?? []).map((p) => [p.lng, p.lat]) },
  };
  const source = map.getSource(LINE_SOURCE) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(LINE_SOURCE, { type: "geojson", data });
  if (!map.getLayer(LINE_LAYER)) {
    map.addLayer({
      id: LINE_LAYER,
      type: "line",
      source: LINE_SOURCE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": 4, "line-opacity": 0.8, "line-dasharray": [2, 1.5] },
    });
  } else {
    map.setPaintProperty(LINE_LAYER, "line-color", color);
  }
}
