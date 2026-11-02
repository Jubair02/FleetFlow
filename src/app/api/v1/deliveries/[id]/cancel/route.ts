import { z } from "zod";
import { db } from "@/lib/db";
import { findDeliveryId, readV1Json, v1Json, validationError, withApiKey } from "@/lib/api-v1";
import { cancelDelivery } from "@/lib/delivery-service";
import { PUBLIC_DELIVERY_INCLUDE, toPublicDelivery } from "@/lib/public-delivery";

type Params = { params: Promise<{ id: string }> };

const cancelSchema = z.object({
  reason: z.string({ message: "reason is required" }).trim().min(1, "reason is required").max(500, "reason must be at most 500 characters"),
});

// POST /api/v1/deliveries/{id}/cancel — cancel a pending (CREATED) or FAILED
// delivery with a reason, the same rule as the app's cancel. Anything already
// with a driver must be cancelled by a dispatcher in FleetFlow (409).
// Cancelling an already-cancelled delivery is a no-op that returns 200.
export async function POST(req: Request, { params }: Params) {
  return withApiKey(req, async (principal) => {
    const { id } = await params;
    const parsed = cancelSchema.safeParse(await readV1Json(req));
    if (!parsed.success) throw validationError(parsed.error);
    const deliveryId = await findDeliveryId(principal.organizationId, id);
    await cancelDelivery(
      { organizationId: principal.organizationId, actorId: null, actorName: principal.actorName },
      deliveryId,
      parsed.data.reason
    );
    const d = await db.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: PUBLIC_DELIVERY_INCLUDE });
    return v1Json({ delivery: toPublicDelivery(d) }, 200, principal);
  });
}
