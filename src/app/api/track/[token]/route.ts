import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { failureReasonLabel } from "@/lib/constants";

type Params = { params: Promise<{ token: string }> };

/**
 * GET /api/track/[token] — public customer tracking.
 *
 * Exposes only customer-safe data: status, timestamps, customer-visible
 * timeline entries. NEVER includes driver identity, vehicle details,
 * internal notes, actor names or business-internal records.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { token } = await params;

    // token format sanity check to avoid odd lookups
    if (!/^[a-f0-9]{16,64}$/i.test(token)) {
      return NextResponse.json({ error: "Invalid tracking link" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const delivery = await db.delivery.findUnique({
      where: { trackingToken: token },
      include: {
        events: { where: { customerVisible: true }, orderBy: { createdAt: "asc" } },
        // Public business details only — the customer knows the sender, not FleetFlow.
        organization: { select: { name: true, phone: true } },
      },
    });

    if (!delivery) {
      return NextResponse.json({ error: "We couldn't find a delivery for this link. Check the link and try again." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (!delivery.trackingEnabled) {
      return NextResponse.json({ error: "This tracking link has been revoked. Contact the sender for a new link." }, { status: 410, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json(
      {
        trackingCode: delivery.trackingCode,
        status: delivery.status,
        recipientName: delivery.recipientName,
        deliveryAddress: delivery.deliveryAddress,
        expectedAt: delivery.expectedAt?.toISOString() ?? null,
        createdAt: delivery.createdAt.toISOString(),
        failureReason: delivery.status === "FAILED" ? failureReasonLabel(delivery.failureReason) : null,
        completedAt: delivery.status === "DELIVERED" ? delivery.completedAt?.toISOString() ?? null : null,
        sender: { name: delivery.organization.name, phone: delivery.organization.phone },
        timeline: delivery.events.map((e) => ({
          eventType: e.eventType,
          // Only pass through notes written intentionally for the customer.
          // Internal notes (driver names, vehicle regs, ops details) never leak.
          note: e.eventType === "NOTE" ? e.note : null,
          timestamp: e.createdAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[track] error:", e);
    return NextResponse.json({ error: "Something went wrong. Please try again later." }, { status: 500 });
  }
}
