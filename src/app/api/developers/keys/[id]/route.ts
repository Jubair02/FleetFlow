import { db } from "@/lib/db";
import { ApiError, fail, ok, requireAdmin } from "@/lib/api-helpers";
import { toApiKeyItem } from "@/lib/api-keys";
import { audit } from "@/lib/developers-service";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/developers/keys/[id] — revoke a key (admin). Takes effect on the
// next request made with it. Allowed on any plan.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const key = await db.$transaction(async (tx) => {
      const existing = await tx.apiKey.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!existing) throw new ApiError(404, "API key not found");
      if (existing.revokedAt) return existing;
      const revoked = await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await audit(tx, user, "API_KEY_REVOKED", "ApiKey", id, { name: existing.name, prefix: existing.prefix });
      return revoked;
    });
    return ok({ key: toApiKeyItem(key) });
  } catch (e) {
    return fail(e);
  }
}
