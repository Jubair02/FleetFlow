import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { trackingActionSchema, firstError } from "@/lib/validation";
import { generateTrackingToken } from "@/lib/delivery";
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
      const delivery = await tx.delivery.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!delivery) throw new ApiError(404, "Delivery not found");

      let note = "";
      if (action === "regenerate") {
        await tx.delivery.update({ where: { id }, data: { trackingToken: generateTrackingToken(), trackingEnabled: true } });
        note = "Tracking link regenerated (old link revoked)";
      } else if (action === "revoke") {
        await tx.delivery.update({ where: { id }, data: { trackingEnabled: false } });
        note = "Tracking link revoked";
      } else {
        await tx.delivery.update({ where: { id }, data: { trackingEnabled: true } });
        note = "Tracking link restored";
      }

      await tx.deliveryEvent.create({
        data: { deliveryId: id, eventType: "TRACKING_UPDATED", actorId: user.id, actorName: user.name, note, customerVisible: false },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: `TRACKING_${action.toUpperCase()}`, entityType: "Delivery", entityId: id,
          detail: { trackingCode: delivery.trackingCode },
        }),
      });
      return { trackingToken: action === "regenerate" ? (await tx.delivery.findUniqueOrThrow({ where: { id } })).trackingToken : delivery.trackingToken, trackingEnabled: action === "revoke" ? false : true };
    });

    return ok({ success: true, trackingToken: result.trackingToken, trackingEnabled: result.trackingEnabled });
  } catch (e) {
    return fail(e);
  }
}
