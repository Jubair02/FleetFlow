import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

// Auth for /api/cron/* (Vercel Cron, see vercel.json): `Authorization: Bearer
// ${CRON_SECRET}`, which Vercel Cron sends when CRON_SECRET is set.

/** Constant-time comparison (hashing first makes the lengths equal). */
function matches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/** A response to return when the request isn't an authorized cron call (503 while CRON_SECRET is unset, 401 otherwise), or null. */
export function cronAuthError(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (!matches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
