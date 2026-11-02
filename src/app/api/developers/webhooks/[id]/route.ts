import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { audit, ENDPOINT_INCLUDE, findOwnEndpoint, updateWebhookSchema } from "@/lib/developers-service";
import { assertFeature } from "@/lib/plans";
import { firstError } from "@/lib/validation";
import { toWebhookEndpointItem } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/developers/webhooks/[id] — edit URL/description/events, or
// enable/disable (admin). Disabling is allowed on any plan; everything else
// needs api_access. Re-enabling clears the failure count.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const parsed = updateWebhookSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const input = parsed.data;
    const onlyDisabling = input.active === false && input.url === undefined && input.events === undefined && input.description === undefined;
    if (!onlyDisabling) await assertFeature(db, user.organizationId, "api_access");

    const endpoint = await db.$transaction(async (tx) => {
      const current = await findOwnEndpoint(tx, user, id);
      const data: Prisma.WebhookEndpointUpdateInput = {};
      const changed: string[] = [];
      if (input.url !== undefined && input.url !== current.url) {
        data.url = input.url;
        changed.push("url");
      }
      if (input.description !== undefined && (input.description || null) !== current.description) {
        data.description = input.description || null;
        changed.push("description");
      }
      if (input.events !== undefined && input.events.join(",") !== current.events.join(",")) {
        data.events = input.events;
        changed.push("events");
      }
      if (input.active !== undefined && input.active !== current.active) {
        data.active = input.active;
        changed.push("active");
        if (input.active) Object.assign(data, { consecutiveFailures: 0, disabledAt: null, disabledReason: null });
        else Object.assign(data, { disabledAt: new Date(), disabledReason: `Disabled by ${user.name}` });
      }
      if (changed.length) {
        await tx.webhookEndpoint.update({ where: { id }, data });
        const toggledOnly = changed.length === 1 && changed[0] === "active";
        const action = toggledOnly ? (input.active ? "WEBHOOK_ENABLED" : "WEBHOOK_DISABLED") : "WEBHOOK_UPDATED";
        await audit(tx, user, action, "WebhookEndpoint", id, { fields: changed, url: input.url ?? current.url });
      }
      return tx.webhookEndpoint.findUniqueOrThrow({ where: { id }, include: ENDPOINT_INCLUDE });
    });
    return ok({ endpoint: toWebhookEndpointItem(endpoint) });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/developers/webhooks/[id] — remove an endpoint and its delivery log (admin).
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    await db.$transaction(async (tx) => {
      const current = await findOwnEndpoint(tx, user, id);
      await tx.webhookEndpoint.delete({ where: { id } }); // deliveries cascade
      await audit(tx, user, "WEBHOOK_DELETED", "WebhookEndpoint", id, { url: current.url });
    });
    return ok({ success: true });
  } catch (e) {
    return fail(e);
  }
}
