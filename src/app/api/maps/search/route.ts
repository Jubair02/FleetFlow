import { ApiError, fail, ok, requireStaff } from "@/lib/api-helpers";
import { hitRateLimit } from "@/lib/api-rate-limit";
import { autocomplete, geocodingEnabled } from "@/lib/barikoi";
import type { PlaceResult } from "@/lib/map-types";

/** Searches per user per minute (the pin picker debounces typing). */
const SEARCHES_PER_MINUTE = 60;

// GET /api/maps/search?q= — address suggestions for the pin picker (staff).
// Proxies Barikoi autocomplete so the API key stays on the server. Without a
// key it answers { enabled: false, results: [] }.
export async function GET(req: Request) {
  try {
    const user = await requireStaff();
    const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
    if (!geocodingEnabled()) return ok({ enabled: false, results: [] as PlaceResult[] });
    if (q.length < 2) return ok({ enabled: true, results: [] as PlaceResult[] });

    const hit = await hitRateLimit(`map-search:${user.id}`, SEARCHES_PER_MINUTE, 60_000);
    if (!hit.allowed) throw new ApiError(429, `Too many searches — try again in ${hit.retryAfter} s`);

    const results: PlaceResult[] = (await autocomplete(q)).slice(0, 10);
    return ok({ enabled: true, results });
  } catch (e) {
    return fail(e);
  }
}
