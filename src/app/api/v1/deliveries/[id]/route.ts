import { db } from "@/lib/db";
import { findDeliveryId, v1Json, withApiKey } from "@/lib/api-v1";
import { PUBLIC_DELIVERY_INCLUDE, toPublicDelivery } from "@/lib/public-delivery";

type Params = { params: Promise<{ id: string }> };

// GET /api/v1/deliveries/{id} — one delivery by id or tracking code (docs/API.md).
export async function GET(req: Request, { params }: Params) {
  return withApiKey(req, async (principal) => {
    const { id } = await params;
    const deliveryId = await findDeliveryId(principal.organizationId, id);
    const d = await db.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: PUBLIC_DELIVERY_INCLUDE });
    return v1Json({ delivery: toPublicDelivery(d) }, 200, principal);
  });
}
