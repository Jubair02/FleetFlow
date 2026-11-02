import { db } from "@/lib/db";
import { ApiError, fail, ok, requireAdmin } from "@/lib/api-helpers";
import { audit } from "@/lib/developers-service";
import { assertFeature } from "@/lib/plans";
import { deliverWebhook, toWebhookDeliveryItem } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

export const maxDuration = 30;

// POST /api/developers/webhook-deliveries/[id]/retry — "Retry now" (admin):
// a FAILED or waiting (PENDING) delivery is sent immediately, even after the
// automatic attempts ran out. The same payload is re-signed at send time.
export async function POST(_req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    await assertFeature(db, user.organizationId, "api_access");
    const { id } = await params;
    const row = await db.webhookDelivery.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { endpoint: { select: { active: true, url: true } } },
    });
    if (!row) throw new ApiError(404, "Webhook delivery not found");
    if (!row.endpoint.active) throw new ApiError(409, "Enable the endpoint before retrying its deliveries");
    if (row.status !== "FAILED" && row.status !== "PENDING") {
      throw new ApiError(409, row.status === "SUCCEEDED" ? "This delivery already succeeded" : "This delivery is being sent right now");
    }
    const requeued = await db.webhookDelivery.updateMany({
      where: { id, status: { in: ["FAILED", "PENDING"] } },
      data: { status: "PENDING", nextAttemptAt: new Date() },
    });
    if (requeued.count !== 1) throw new ApiError(409, "This delivery is being sent right now");
    await audit(db, user, "WEBHOOK_RETRIED", "WebhookDelivery", id, { event: row.event, url: row.endpoint.url });
    await deliverWebhook(id);
    const result = await db.webhookDelivery.findUniqueOrThrow({ where: { id } });
    return ok({ delivery: toWebhookDeliveryItem(result) });
  } catch (e) {
    return fail(e);
  }
}
