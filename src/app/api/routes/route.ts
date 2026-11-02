import { ApiError, fail, ok, readJson, requireStaff } from "@/lib/api-helpers";
import { getRoutePlan, reorderRouteSchema, saveRoute } from "@/lib/route-service";
import { firstError } from "@/lib/validation";

// GET /api/routes?driverId= — a driver's open stops in route order, with
// saved arrival estimates and live distance/time totals (staff, live_map).
export async function GET(req: Request) {
  try {
    const user = await requireStaff();
    const driverId = new URL(req.url).searchParams.get("driverId")?.trim();
    if (!driverId) throw new ApiError(400, "Choose a driver");
    return ok(await getRoutePlan(user, driverId));
  } catch (e) {
    return fail(e);
  }
}

// PUT /api/routes { driverId, order: deliveryId[] } — save a manual stop
// order (exactly the driver's open stops) and recompute arrival estimates.
export async function PUT(req: Request) {
  try {
    const user = await requireStaff();
    const parsed = reorderRouteSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    return ok(await saveRoute(user, parsed.data.driverId, { kind: "manual", order: parsed.data.order }));
  } catch (e) {
    return fail(e);
  }
}
