import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import type { SessionUser } from "@/lib/auth";
import { auditData } from "@/lib/notify";
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from "@/lib/developers";
import { validateWebhookUrl, WebhookUrlError } from "@/lib/webhook-url";

// ─────────────────────────────────────────────────────────────
// Company-side management of API keys and webhook endpoints
// (/api/developers/**, admin only, every change audited).
// ─────────────────────────────────────────────────────────────

const webhookUrl = z.string({ message: "Enter the URL that should receive webhooks" }).transform((raw, ctx) => {
  try {
    return validateWebhookUrl(raw);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: e instanceof WebhookUrlError ? e.message : "Enter a valid URL" });
    return z.NEVER;
  }
});

const events = z
  .array(z.enum(WEBHOOK_EVENT_TYPES as [WebhookEventType, ...WebhookEventType[]], "Unknown event"), { message: "Choose events" })
  .min(1, "Choose at least one event")
  .transform((list) => WEBHOOK_EVENT_TYPES.filter((e) => list.includes(e))); // dedupe, canonical order

const description = z
  .string()
  .trim()
  .max(200, "Description must be at most 200 characters")
  .optional()
  .or(z.literal(""))
  .nullable();

export const createWebhookSchema = z.object({ url: webhookUrl, description, events });
export const updateWebhookSchema = z.object({
  url: webhookUrl.optional(),
  description,
  events: events.optional(),
  /** true re-enables a (possibly auto-)disabled endpoint and clears its failure count. */
  active: z.boolean().optional(),
});
export const createApiKeySchema = z.object({
  name: z.string({ message: "Name the key" }).trim().min(2, "Name the key, e.g. “WooCommerce store”").max(60, "Name must be at most 60 characters"),
});

type Tx = Prisma.TransactionClient | typeof db;

/** An endpoint of the admin's own organization, or 404. */
export async function findOwnEndpoint(client: Tx, user: SessionUser, id: string) {
  const endpoint = await client.webhookEndpoint.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!endpoint) throw new ApiError(404, "Webhook endpoint not found");
  return endpoint;
}

export function audit(
  client: Tx,
  user: SessionUser,
  action: string,
  entityType: "ApiKey" | "WebhookEndpoint" | "WebhookDelivery",
  entityId: string,
  detail?: Record<string, unknown>
) {
  return client.auditLog.create({
    data: auditData({ organizationId: user.organizationId, actorId: user.id, actorName: user.name, action, entityType, entityId, detail }),
  });
}

/** Endpoint list include: the latest delivery for the row summary. */
export const ENDPOINT_INCLUDE = {
  deliveries: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { status: true, responseStatus: true, lastAttemptAt: true, createdAt: true },
  },
} satisfies Prisma.WebhookEndpointInclude;
