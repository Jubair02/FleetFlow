import { fail, ok, requireUser } from "@/lib/api-helpers";
import { barikoiStyleUrl, geocodingEnabled } from "@/lib/barikoi";
import type { MapConfig } from "@/lib/map-types";

// GET /api/maps/config — map style for the browser (any signed-in user).
// The Barikoi map key travels inside styleUrl (it is a browser key by
// nature — restrict it to your domain; docs/MAPS.md). Without one the
// client draws OpenStreetMap raster tiles.
export async function GET() {
  try {
    await requireUser();
    const styleUrl = barikoiStyleUrl();
    const body: MapConfig = { provider: styleUrl ? "barikoi" : "osm", styleUrl, geocoding: geocodingEnabled() };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
