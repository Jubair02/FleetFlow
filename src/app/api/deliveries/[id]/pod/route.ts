import { db } from "@/lib/db";
import { ApiError, fail, ok, requireDriver } from "@/lib/api-helpers";
import { ACTIVE_JOB_STATUSES, type DeliveryStatus } from "@/lib/constants";
import { TX_OPTIONS, closeAssignment, lockDelivery } from "@/lib/delivery";
import { deletePodFile, savePodFile } from "@/lib/storage";
import { auditData, bestEffort, notifyAdmins, sendCustomerOutcomeEmail } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// Whole multipart body cap — the 8 MB image plus form fields/boundaries.
const MAX_BODY_BYTES = 9 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type PodTarget = { status: string; assignments: { id: string; driverId: string }[] };

/** The caller must hold the active assignment and the job must accept proof. */
function assertPodAllowed(delivery: PodTarget, userId: string, complete: boolean) {
  const mine = delivery.assignments.find((a) => a.driverId === userId);
  if (!mine) throw new ApiError(403, "You can only add proof to deliveries assigned to you");
  if (!ACTIVE_JOB_STATUSES.includes(delivery.status as DeliveryStatus)) {
    throw new ApiError(409, "Proof can only be added to a delivery that is in progress");
  }
  if (complete && delivery.status !== "IN_TRANSIT") {
    throw new ApiError(409, "Mark the delivery as “In transit” before completing it");
  }
  return mine;
}

/**
 * POST /api/deliveries/[id]/pod — driver uploads proof of delivery.
 * Multipart: file (PNG/JPEG/WebP), recipientName, kind (SIGNATURE|PHOTO), complete ("true"|"false").
 * When complete=true, the delivery is transitioned to DELIVERED atomically
 * (only allowed from IN_TRANSIT, and a POD record is mandatory for that).
 *
 * Oversized bodies are refused before parsing, and the caller's right to add
 * proof is checked before the file is written. The check is repeated under
 * the delivery lock; if the transaction fails the stored file is removed.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireDriver();
    const { id } = await params;

    // refuse oversized uploads before buffering the body
    const lengthHeader = req.headers.get("content-length");
    if (!lengthHeader) throw new ApiError(411, "Content-Length is required");
    const length = Number(lengthHeader);
    if (!Number.isFinite(length) || length < 0) throw new ApiError(400, "Invalid Content-Length");
    if (length > MAX_BODY_BYTES) throw new ApiError(413, "File too large (max 8 MB)");

    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected multipart form data");
    const file = form.get("file");
    const recipientName = String(form.get("recipientName") || "").trim();
    const kind = String(form.get("kind") || "SIGNATURE") === "PHOTO" ? "PHOTO" : "SIGNATURE";
    const complete = String(form.get("complete") || "false") === "true";

    if (!(file instanceof File)) throw new ApiError(400, "A proof image is required");
    if (recipientName.length > 120) throw new ApiError(400, "Recipient name is too long (max 120 characters)");
    if (complete && recipientName.length < 2) throw new ApiError(400, "Recipient name is required to complete the delivery");
    if (file.size > MAX_FILE_BYTES) throw new ApiError(413, "File too large (max 8 MB)");

    // authorize before touching storage
    const current = await db.delivery.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { assignments: { where: { active: true }, select: { id: true, driverId: true } } },
    });
    if (!current) throw new ApiError(404, "Delivery not found");
    assertPodAllowed(current, user.id, complete);

    const buffer = Buffer.from(await file.arrayBuffer());
    let stored;
    try {
      stored = await savePodFile(buffer, file.name || "proof.png");
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Invalid file");
    }

    let result;
    try {
      result = await db.$transaction(async (tx) => {
        await lockDelivery(tx, id, user.organizationId);
        const delivery = await tx.delivery.findUniqueOrThrow({
          where: { id },
          include: { assignments: { where: { active: true }, select: { id: true, driverId: true } } },
        });
        const mine = assertPodAllowed(delivery, user.id, complete);

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
          await tx.delivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED", completedAt: now, failureReason: null } });
          await closeAssignment(tx, mine, "DELIVERED", now);
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
        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId, actorId: user.id, actorName: user.name,
            action: "POD_UPLOADED", entityType: "Delivery", entityId: delivery.id,
            detail: { trackingCode: delivery.trackingCode, podId: pod.id, kind },
          }),
        });
        return { delivery, completed: false as const };
      }, TX_OPTIONS);
    } catch (txError) {
      // nothing references the file now — don't leave an orphan on disk
      await deletePodFile(stored.fileKey);
      throw txError;
    }

    if (result.completed) {
      await bestEffort("pod: completion notification", () =>
        notifyAdmins(
          user.organizationId,
          {
            type: "DELIVERED",
            title: "Delivery completed",
            body: `${result.delivery.trackingCode} was delivered by ${user.name} — proof of delivery recorded.`,
            deliveryId: result.delivery.id,
          },
          { email: true, emailDedupeKey: `delivered:${result.delivery.id}` }
        )
      );
      await bestEffort("pod: customer email", () =>
        sendCustomerOutcomeEmail({
          organizationId: user.organizationId,
          delivery: result.delivery,
          outcome: "DELIVERED",
          eventKey: `delivered:${result.delivery.id}`,
        })
      );
    } else {
      await bestEffort("pod: upload notification", () =>
        notifyAdmins(user.organizationId, {
          type: "POD_UPLOADED",
          title: "Proof of delivery uploaded",
          body: `${user.name} uploaded a ${kind.toLowerCase()} for ${result.delivery.trackingCode}.`,
          deliveryId: result.delivery.id,
        })
      );
    }

    return ok({ success: true, completed: result.completed }, 201);
  } catch (e) {
    return fail(e);
  }
}
