import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireDriver } from "@/lib/api-helpers";
import { hitRateLimit } from "@/lib/api-rate-limit";
import { assertFeature } from "@/lib/plans";
import { firstError } from "@/lib/validation";
import {
  LOCATION_MIN_INTERVAL_MS,
  LOCATION_SEND_INTERVAL_MS,
  driverLocationSchema,
  hasInProgressJob,
  locationRow,
} from "@/lib/live-location";

/**
 * POST /api/driver/location — the driver app reports where the driver is
 * (DRIVER only; plan feature live_map). Body: { lat, lng, accuracy?, heading?,
 * speedKmh?, recordedAt? }. Only the latest position is kept (upsert).
 *
 *   403  the plan has no live map — the app stops sending
 *   409  no picked-up / in-transit job — nothing is stored (never off-shift)
 *   429  more than one fix per LOCATION_MIN_INTERVAL_MS
 *   422  the point is outside the service area
 */
export async function POST(req: Request) {
  try {
    const user = await requireDriver();
    await assertFeature(db, user.organizationId, "live_map");
    const parsed = driverLocationSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));

    if (!(await hasInProgressJob(db, user.id))) {
      // nothing in progress: make sure no old position lingers either
      await db.driverLocation.deleteMany({ where: { userId: user.id } });
      throw new ApiError(409, "Location is only shared while a delivery is picked up or in transit");
    }

    // validate before counting, so a rejected fix doesn't block the next good one
    const row = locationRow(parsed.data);
    if (!row) throw new ApiError(422, "That position is outside the service area");

    const hit = await hitRateLimit(`driver-loc:${user.id}`, 1, LOCATION_MIN_INTERVAL_MS);
    if (!hit.allowed) {
      return NextResponse.json(
        { error: "Location sent too often", retryAfter: hit.retryAfter },
        { status: 429, headers: { "Retry-After": String(hit.retryAfter) } }
      );
    }

    await db.driverLocation.upsert({
      where: { userId: user.id },
      create: { userId: user.id, organizationId: user.organizationId, ...row },
      update: { organizationId: user.organizationId, ...row },
    });
    return ok({ success: true, nextInMs: LOCATION_SEND_INTERVAL_MS });
  } catch (e) {
    return fail(e);
  }
}
