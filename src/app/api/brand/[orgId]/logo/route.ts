import { db } from "@/lib/db";
import { BRANDED_TRACKING_FEATURE, brandLogoVersion } from "@/lib/branding";
import { readStoredFile, storedImageMime } from "@/lib/storage";

type Params = { params: Promise<{ orgId: string }> };

const ORG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Headers every answer carries: never sniff, never frame, no scripts even if opened directly. */
const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

function notFound() {
  return new Response("Not found", { status: 404, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" } });
}

/**
 * GET /api/brand/[orgId]/logo?v=<version> — a company's tracking-page logo.
 * Public (customers aren't signed in), and only served while the company has
 * a logo AND its plan includes branded_tracking. The address carries the
 * logo's version (src/lib/branding.ts brandLogoUrl), so a matching `v` is
 * cached for a year as immutable; a replaced logo gets a new address. Other
 * requests revalidate with the ETag.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    const { orgId } = await params;
    if (!ORG_ID_RE.test(orgId)) return notFound();

    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { brandLogoKey: true, planRecord: { select: { features: true } } },
    });
    if (!org?.brandLogoKey || !org.planRecord.features.includes(BRANDED_TRACKING_FEATURE)) return notFound();

    const version = brandLogoVersion(org.brandLogoKey);
    const etag = `"${version}"`;
    const pinned = new URL(req.url).searchParams.get("v") === version;
    const cacheControl = pinned ? "public, max-age=31536000, immutable" : "public, max-age=300, must-revalidate";

    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
      return new Response(null, { status: 304, headers: { ...BASE_HEADERS, ETag: etag, "Cache-Control": cacheControl } });
    }

    const mime = storedImageMime(org.brandLogoKey);
    if (!mime) return notFound();
    let data: Buffer;
    try {
      data = await readStoredFile(org.brandLogoKey);
    } catch {
      return notFound();
    }

    return new Response(new Uint8Array(data), {
      headers: {
        ...BASE_HEADERS,
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "Content-Disposition": "inline",
        ETag: etag,
        "Cache-Control": cacheControl,
      },
    });
  } catch (e) {
    console.error("[brand logo] error:", e);
    return new Response("Error", { status: 500, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}
