import { db } from "@/lib/db";
import { fail, ok, requireAdmin } from "@/lib/api-helpers";
import { toApiKeyItem } from "@/lib/api-keys";
import { ENDPOINT_INCLUDE } from "@/lib/developers-service";
import type { DevelopersOverview } from "@/lib/developers";
import { appBaseUrl } from "@/lib/email/templates";
import { getOrgPlan } from "@/lib/plans";
import { toWebhookEndpointItem } from "@/lib/webhooks";

// GET /api/developers — API keys and webhook endpoints of the company (admin).
// Works without api_access too, so the UI can show the upgrade prompt and
// still let admins revoke keys / delete endpoints left from a previous plan.
export async function GET() {
  try {
    const user = await requireAdmin();
    const [plan, keys, endpoints] = await Promise.all([
      getOrgPlan(db, user.organizationId),
      db.apiKey.findMany({
        where: { organizationId: user.organizationId },
        orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      }),
      db.webhookEndpoint.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "asc" }, include: ENDPOINT_INCLUDE }),
    ]);
    const body: DevelopersOverview = {
      apiAccess: plan.features.includes("api_access"),
      planName: plan.name,
      apiBaseUrl: `${appBaseUrl()}/api/v1`,
      keys: keys.map(toApiKeyItem),
      endpoints: endpoints.map(toWebhookEndpointItem),
    };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}
