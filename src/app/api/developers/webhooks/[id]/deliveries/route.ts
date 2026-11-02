import { db } from "@/lib/db";
import { fail, ok, requireAdmin } from "@/lib/api-helpers";
import { findOwnEndpoint } from "@/lib/developers-service";
import { toWebhookDeliveryItem } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

// GET /api/developers/webhooks/[id]/deliveries — the endpoint's 25 most recent deliveries (admin).
export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    await findOwnEndpoint(db, user, id);
    const rows = await db.webhookDelivery.findMany({
      where: { endpointId: id, organizationId: user.organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25,
    });
    return ok({ items: rows.map(toWebhookDeliveryItem) });
  } catch (e) {
    return fail(e);
  }
}
