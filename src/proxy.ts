import { NextResponse, type NextRequest } from "next/server";

// CSRF defence for the cookie-authenticated API: browsers always send
// Origin on cross-site POST/PATCH/DELETE, so reject any write whose
// Origin doesn't match the host serving the app.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return NextResponse.next();
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.next(); // same-origin fetches from older browsers / server tools
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    /* malformed Origin */
  }
  if (!host || originHost !== host) {
    return NextResponse.json({ error: "Cross-site request rejected" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
