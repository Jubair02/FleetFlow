import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { audit, findOwnEndpoint } from "@/lib/developers-service";
import { assertFeature } from "@/lib/plans";
import { firstError } from "@/lib/validation";
import { generateWebhookSecret } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ action: z.enum(["reveal", "rotate"], { message: "action must be reveal or rotate" }) });

// POST /api/developers/webhooks/[id]/secret — { action: "reveal" | "rotate" } (admin, audited).
// Rotation takes effect immediately: retries of queued events are signed with the new secret.
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    await assertFeature(db, user.organizationId, "api_access");
    const { id } = await params;
    const parsed = schema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));

    const secret = await db.$transaction(async (tx) => {
      const endpoint = await findOwnEndpoint(tx, user, id);
      if (parsed.data.action === "reveal") {
        await audit(tx, user, "WEBHOOK_SECRET_REVEALED", "WebhookEndpoint", id, { url: endpoint.url });
        return endpoint.secret;
      }
      const fresh = generateWebhookSecret();
      await tx.webhookEndpoint.update({ where: { id }, data: { secret: fresh } });
      await audit(tx, user, "WEBHOOK_SECRET_ROTATED", "WebhookEndpoint", id, { url: endpoint.url });
      return fresh;
    });
    return ok({ secret });
  } catch (e) {
    return fail(e);
  }
}
