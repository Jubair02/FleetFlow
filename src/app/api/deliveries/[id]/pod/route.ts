import { db } from "@/lib/db";
import { ApiError, fail, ok, requireDriver } from "@/lib/api-helpers";
import { codAmount, firstError } from "@/lib/validation";
import { ACTIVE_JOB_STATUSES, type DeliveryStatus } from "@/lib/constants";
import { TX_OPTIONS, closeAssignment, lockDelivery, codCompletionData } from "@/lib/delivery";
import { MAX_POD_FILE_BYTES, PodFileError, deletePodFile, savePodFile } from "@/lib/storage";
import { auditData, bestEffort, notifyAdmins, sendCustomerOutcomeEmail } from "@/lib/notify";
import { dispatchWebhooksSoon, queueDeliveryStatusChange } from "@/lib/webhooks";
import { inServiceArea, roundCoord, toLatLng } from "@/lib/geo";
import { pointData } from "@/lib/geocoding";
import { clearLocationIfIdle } from "@/lib/live-location";

type Params = { params: Promise<{ id: string }> };

// Whole multipart body cap — the image plus form fields/boundaries. Stays
// under Vercel's ~4.5 MB request limit; the driver app downsizes photos first.
const MAX_BODY_BYTES = MAX_POD_FILE_BYTES + 256 * 1024;

/** Optional browser geolocation sent with the proof; ignored unless all values are sane. */
function parseLocation(form: FormData): { latitude?: number; longitude?: number; locationAccuracyM?: number } {
  const num = (k: string) => {
    const v = form.get(k);
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const lat = num("latitude");
  const lng = num("longitude");
  const acc = num("accuracy");
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return {};
  return { latitude: lat, longitude: lng, ...(acc !== null && acc >= 0 && acc < 100_000 ? { locationAccuracyM: acc } : {}) };
}

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
 * Multipart: file (PNG/JPEG/WebP), recipientName, kind (SIGNATURE|PHOTO), complete ("true"|"false"),
 * optional codCollected (whole BDT; required to complete a cash-on-delivery job) and
 * optional latitude / longitude / accuracy (the driver's position from the browser).
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
    if (length > MAX_BODY_BYTES) throw new ApiError(413, "File too large (max 4 MB)");

    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected multipart form data");
    const file = form.get("file");
    const recipientName = String(form.get("recipientName") || "").trim();
    const kind = String(form.get("kind") || "SIGNATURE") === "PHOTO" ? "PHOTO" : "SIGNATURE";
    const complete = String(form.get("complete") || "false") === "true";
    const codField = form.get("codCollected");
    const codParsed = codField === null || codField === "" ? null : codAmount.safeParse(codField);
    if (codParsed && !codParsed.success) throw new ApiError(400, firstError(codParsed.error));
    const codCollected = codParsed?.success ? codParsed.data : undefined;
    const location = parseLocation(form);

    if (!(file instanceof File)) throw new ApiError(400, "A proof image is required");
    if (recipientName.length > 120) throw new ApiError(400, "Recipient name is too long (max 120 characters)");
    if (complete && recipientName.length < 2) throw new ApiError(400, "Recipient name is required to complete the delivery");
    if (file.size > MAX_POD_FILE_BYTES) throw new ApiError(413, "File too large (max 4 MB)");

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
      // Only problems with the file itself are shown; storage failures are logged by fail().
      if (e instanceof PodFileError) throw new ApiError(400, e.message);
      throw e;
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
            ...location,
          },
        });
        // No map point yet: where the driver handed it over is the best one we'll get.
        const gps = location.latitude !== undefined && location.longitude !== undefined ? toLatLng(location.latitude, location.longitude) : null;
        if (gps && inServiceArea(gps) && (delivery.deliveryLat === null || delivery.deliveryLng === null)) {
          await tx.delivery.update({
            where: { id: delivery.id },
            data: pointData({ lat: roundCoord(gps.lat), lng: roundCoord(gps.lng) }, "DRIVER"),
          });
        }

        if (complete) {
          const now = new Date();
          await tx.delivery.update({
            where: { id: delivery.id },
            data: { status: "DELIVERED", completedAt: now, failureReason: null, ...codCompletionData(delivery, codCollected, user.id, now) },
          });
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
          await queueDeliveryStatusChange(tx, user.organizationId, delivery.id, delivery.status, "DELIVERED");
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
      dispatchWebhooksSoon(user.organizationId);
      // last in-progress job done → stop keeping their live position
      await bestEffort("pod: clear live location", () => clearLocationIfIdle(user.id));
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
