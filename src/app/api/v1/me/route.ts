import { db } from "@/lib/db";
import { v1Json, withApiKey } from "@/lib/api-v1";

// GET /api/v1/me — which company and key a request authenticates as.
// Cheap "test connection" call for integrations (docs/API.md).
export async function GET(req: Request) {
  return withApiKey(req, async (principal) => {
    const org = await db.organization.findUniqueOrThrow({ where: { id: principal.organizationId }, select: { name: true } });
    const key = await db.apiKey.findUniqueOrThrow({ where: { id: principal.keyId }, select: { name: true, prefix: true } });
    return v1Json({ organization: { name: org.name }, apiKey: { name: key.name, prefix: key.prefix } }, 200, principal);
  });
}
