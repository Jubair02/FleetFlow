import { db } from "@/lib/db";
import { ApiError, fail, ok, requireAdmin } from "@/lib/api-helpers";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { assertFeature } from "@/lib/plans";
import { BRAND_LOGO_MAX_BYTES, BRANDED_TRACKING_FEATURE, brandLogoUrl } from "@/lib/branding";
import { PodFileError, deleteStoredFile, saveImageFile } from "@/lib/storage";

// Whole multipart body cap: the image plus form fields / boundaries.
const MAX_BODY_BYTES = BRAND_LOGO_MAX_BYTES + 64 * 1024;

/**
 * POST /api/settings/tracking/logo — upload the tracking-page logo (admin,
 * branded_tracking plan feature). Multipart `file`: PNG, JPEG or WebP up to
 * 1 MB, checked by content (SVG is refused — it can carry script). Replaces
 * the previous logo, which is then deleted from storage. Audited.
 */
export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    await assertFeature(db, user.organizationId, BRANDED_TRACKING_FEATURE);

    const lengthHeader = req.headers.get("content-length");
    if (!lengthHeader) throw new ApiError(411, "Content-Length is required");
    const length = Number(lengthHeader);
    if (!Number.isFinite(length) || length < 0) throw new ApiError(400, "Invalid Content-Length");
    if (length > MAX_BODY_BYTES) throw new ApiError(413, "Logo too large (max 1 MB)");

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new ApiError(400, "Choose an image file");

    let stored;
    try {
      stored = await saveImageFile(Buffer.from(await file.arrayBuffer()), file.name || "logo", "brand");
    } catch (e) {
      if (e instanceof PodFileError) throw new ApiError(400, e.message);
      throw e;
    }

    let previousKey: string | null = null;
    try {
      previousKey = await db.$transaction(async (tx) => {
        const current = await tx.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { brandLogoKey: true } });
        await tx.organization.update({ where: { id: user.organizationId }, data: { brandLogoKey: stored.fileKey } });
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId,
            actorId: user.id,
            actorName: user.name,
            action: "TRACKING_LOGO_UPDATED",
            entityType: "Organization",
            entityId: user.organizationId,
            detail: { fileName: stored.fileName, mimeType: stored.mimeType, size: stored.size, replaced: !!current.brandLogoKey },
          }),
        });
        return current.brandLogoKey;
      }, TX_OPTIONS);
    } catch (e) {
      await deleteStoredFile(stored.fileKey); // nothing points at it
      throw e;
    }
    if (previousKey) await deleteStoredFile(previousKey);

    return ok({ logoUrl: brandLogoUrl(user.organizationId, stored.fileKey) });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/settings/tracking/logo — remove the logo (admin; allowed on every plan). Audited. */
export async function DELETE() {
  try {
    const user = await requireAdmin();
    const previousKey = await db.$transaction(async (tx) => {
      const current = await tx.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { brandLogoKey: true } });
      if (!current.brandLogoKey) return null;
      await tx.organization.update({ where: { id: user.organizationId }, data: { brandLogoKey: null } });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId,
          actorId: user.id,
          actorName: user.name,
          action: "TRACKING_LOGO_REMOVED",
          entityType: "Organization",
          entityId: user.organizationId,
        }),
      });
      return current.brandLogoKey;
    }, TX_OPTIONS);
    if (previousKey) await deleteStoredFile(previousKey);
    return ok({ logoUrl: null });
  } catch (e) {
    return fail(e);
  }
}
