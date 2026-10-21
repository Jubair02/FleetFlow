import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { trackingActionSchema, firstError } from "@/lib/validation";
import { TX_OPTIONS, generateTrackingToken, lockDelivery } from "@/lib/delivery";
import { auditData } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// POST /api/deliveries/[id]/tracking — manage the public tracking link
// action: regenerate (new unguessable token) | revoke | restore
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const parsed = trackingActionSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { action } = parsed.data;

    const result = await db.$transaction(async (tx) => {
      await lockDelivery(tx, id, user.organizationId);

      let note = "";
      let data: { trackingToken?: string; trackingEnabled: boolean };
      if (action === "regenerate") {
        data = { trackingToken: generateTrackingToken(), trackingEnabled: true };
        note = "Tracking link regenerated (old link revoked)";
      } else if (action === "revoke") {
        data = { trackingEnabled: false };
        note = "Tracking link revoked";
      } else {
        data = { trackingEnabled: true };
        note = "Tracking link restored";
      }
      const updated = await tx.delivery.update({ where: { id }, data });

      await tx.deliveryEvent.create({
        data: { deliveryId: id, eventType: "TRACKING_UPDATED", actorId: user.id, actorName: user.name, note, customerVisible: false },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: `TRACKING_${action.toUpperCase()}`, entityType: "Delivery", entityId: id,
          detail: { trackingCode: updated.trackingCode },
        }),
      });
      return { trackingToken: updated.trackingToken, trackingEnabled: updated.trackingEnabled };
    }, TX_OPTIONS);

    return ok({ success: true, trackingToken: result.trackingToken, trackingEnabled: result.trackingEnabled });
  } catch (e) {
    return fail(e);
  }
}
