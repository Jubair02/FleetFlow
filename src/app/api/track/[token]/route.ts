import { NextResponse } from "next/server";
import { loadTracking } from "@/lib/tracking";

type Params = { params: Promise<{ token: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/track/[token] — public customer tracking (polled by /track/[token]).
 *
 * The payload is built by src/lib/tracking.ts, shared with the server-rendered
 * page: customer-safe data only — status, timestamps, customer-visible
 * timeline entries. NEVER driver identity, vehicle details, internal notes,
 * actor names or business-internal records.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { token } = await params;
    const result = await loadTracking(token);

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "We couldn't find a delivery for this link. Check the link and try again." }, { status: 404, headers: NO_STORE });
    }
    if (result.kind === "revoked") {
      return NextResponse.json({ error: "This tracking link has been revoked. Contact the sender for a new link." }, { status: 410, headers: NO_STORE });
    }
    return NextResponse.json(result.data, { headers: NO_STORE });
  } catch (e) {
    console.error("[track] error:", e);
    return NextResponse.json({ error: "Something went wrong. Please try again later." }, { status: 500 });
  }
}
