import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { audit, createWebhookSchema, ENDPOINT_INCLUDE } from "@/lib/developers-service";
import { MAX_WEBHOOK_ENDPOINTS } from "@/lib/developers";
import { assertFeature } from "@/lib/plans";
import { firstError } from "@/lib/validation";
import { generateWebhookSecret, toWebhookEndpointItem } from "@/lib/webhooks";

// POST /api/developers/webhooks — add an endpoint (admin, plan needs api_access).
// The signing secret is generated here; admins reveal it from the endpoint row.
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    await assertFeature(db, user.organizationId, "api_access");
    const parsed = createWebhookSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { url, description, events } = parsed.data;

    const count = await db.webhookEndpoint.count({ where: { organizationId: user.organizationId } });
    if (count >= MAX_WEBHOOK_ENDPOINTS) throw new ApiError(409, `You can have at most ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints`);

    const endpoint = await db.$transaction(async (tx) => {
      const created = await tx.webhookEndpoint.create({
        data: { organizationId: user.organizationId, url, description: description || null, events, secret: generateWebhookSecret() },
        include: ENDPOINT_INCLUDE,
      });
      await audit(tx, user, "WEBHOOK_CREATED", "WebhookEndpoint", created.id, { url, events });
      return created;
    });
    return ok({ endpoint: toWebhookEndpointItem(endpoint) }, 201);
  } catch (e) {
    return fail(e);
  }
}
