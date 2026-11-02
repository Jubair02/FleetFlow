"use client";

import { useApiData } from "@/lib/api-client";
import type { MapConfig } from "@/lib/map-types";

/** Map settings for signed-in screens (GET /api/maps/config; cached, one request shared by every map). */
export function useMapConfig(): MapConfig | null {
  return useApiData<MapConfig>("/api/maps/config").data;
}
