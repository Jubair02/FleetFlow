import { ApiError, fail, ok, readJson, requireStaff } from "@/lib/api-helpers";
import { optimizeRouteSchema, saveRoute } from "@/lib/route-service";
import { firstError } from "@/lib/validation";

// POST /api/routes/optimize { driverId } — reorder the driver's open stops
// (priority first, then shortest estimated road distance) and save the
// order with arrival estimates. Staff only, needs the live_map feature.
export async function POST(req: Request) {
  try {
    const user = await requireStaff();
    const parsed = optimizeRouteSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    return ok(await saveRoute(user, parsed.data.driverId, { kind: "optimize" }));
  } catch (e) {
    return fail(e);
  }
}
