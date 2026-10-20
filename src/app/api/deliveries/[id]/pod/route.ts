import { db } from "@/lib/db";
import { ApiError, fail, ok, requireDriver } from "@/lib/api-helpers";
import { savePodFile } from "@/lib/storage";
import { auditData, notifyAdmins } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/deliveries/[id]/pod — driver uploads proof of delivery.
 * Multipart: file (PNG/JPEG/WebP), recipientName, kind (SIGNATURE|PHOTO), complete ("true"|"false").
 * When complete=true, the delivery is transitioned to DELIVERED atomically
 * (only allowed from IN_TRANSIT, and a POD record is mandatory for that).
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireDriver();
    const { id } = await params;

    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected multipart form data");
    const file = form.get("file");
    const recipientName = String(form.get("recipientName") || "").trim();
    const kind = String(form.get("kind") || "SIGNATURE") === "PHOTO" ? "PHOTO" : "SIGNATURE";
    const complete = String(form.get("complete") || "false") === "true";

    if (!(file instanceof File)) throw new ApiError(400, "A proof image is required");
    if (complete && !recipientName) throw new ApiError(400, "Recipient name is required to complete the delivery");
    if (file.size > 8 * 1024 * 1024) throw new ApiError(400, "File too large (max 8 MB)");

    const buffer = Buffer.from(await file.arrayBuffer());
    let stored;
    try {
      stored = await savePodFile(buffer, file.name || "proof.png");
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Invalid file");
    }

    const result = await db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { assignments: { where: { active: true } } },
      });
      if (!delivery) throw new ApiError(404, "Delivery not found");

      const mine = delivery.assignments.find((a) => a.driverId === user.id);
      if (!mine) throw new ApiError(403, "You can only add proof to deliveries assigned to you");
      if (complete && delivery.status !== "IN_TRANSIT") {
        throw new ApiError(400, "Mark the delivery as “In transit” before completing it");
      }

      const pod = await tx.proofOfDelivery.create({
        data: {
          deliveryId: delivery.id,
          fileKey: stored.fileKey,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          kind,
          recipientName: recipientName || delivery.recipientName,
          uploadedById: user.id,
        },
      });

      if (complete) {
        const now = new Date();
        await tx.delivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED", completedAt: now } });
        await tx.assignment.update({ where: { id: mine.id }, data: { active: false, completedAt: now } });
        const remaining = await tx.assignment.count({ where: { driverId: user.id, active: true } });
        if (remaining === 0) {
          await tx.driverProfile.updateMany({ where: { userId: user.id, availability: "ON_ROUTE" }, data: { availability: "AVAILABLE" } });
        }
        await tx.deliveryEvent.create({
          data: {
            deliveryId: delivery.id, eventType: "DELIVERED", actorId: user.id, actorName: user.name,
            note: `Delivered to ${recipientName} — proof recorded`, customerVisible: true,
          },
        });
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "DELIVERY_COMPLETED", entityType: "Delivery", entityId: delivery.id,
            detail: { trackingCode: delivery.trackingCode, podId: pod.id, kind },
          }),
        });
        return { delivery, completed: true as const };
      }

      await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id, eventType: "NOTE", actorId: user.id, actorName: user.name,
          note: `Proof of delivery uploaded (${kind.toLowerCase()})`, customerVisible: false,
        },
      });
      return { delivery, completed: false as const };
    });

    if (result.completed) {
      await notifyAdmins(
        user.organizationId,
        {
          type: "DELIVERED",
          title: "Delivery completed",
          body: `${result.delivery.trackingCode} was delivered by ${user.name} — proof of delivery recorded.`,
          deliveryId: result.delivery.id,
        },
        { email: true }
      );
    } else {
      await notifyAdmins(user.organizationId, {
        type: "POD_UPLOADED",
        title: "Proof of delivery uploaded",
        body: `${user.name} uploaded a ${kind.toLowerCase()} for ${result.delivery.trackingCode}.`,
        deliveryId: result.delivery.id,
      });
    }

    return ok({ success: true, completed: result.completed }, 201);
  } catch (e) {
    return fail(e);
  }
}
