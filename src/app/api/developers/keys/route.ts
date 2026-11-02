import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { generateApiKey, toApiKeyItem } from "@/lib/api-keys";
import { audit, createApiKeySchema } from "@/lib/developers-service";
import { MAX_API_KEYS, type CreatedApiKey } from "@/lib/developers";
import { assertFeature } from "@/lib/plans";
import { firstError } from "@/lib/validation";

// POST /api/developers/keys — create an API key (admin, plan needs api_access).
// The full key is in this response only; the database keeps its SHA-256.
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    await assertFeature(db, user.organizationId, "api_access");
    const parsed = createApiKeySchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));

    const active = await db.apiKey.count({ where: { organizationId: user.organizationId, revokedAt: null } });
    if (active >= MAX_API_KEYS) throw new ApiError(409, `You can have at most ${MAX_API_KEYS} active API keys — revoke one you no longer use`);

    const { key, prefix, keyHash } = generateApiKey();
    const row = await db.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: { organizationId: user.organizationId, name: parsed.data.name, prefix, keyHash, createdById: user.id, createdByName: user.name },
      });
      await audit(tx, user, "API_KEY_CREATED", "ApiKey", created.id, { name: created.name, prefix });
      return created;
    });
    const body: CreatedApiKey = { key: toApiKeyItem(row), secret: key };
    return ok(body, 201);
  } catch (e) {
    return fail(e);
  }
}
