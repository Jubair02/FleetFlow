import { db } from "@/lib/db";
import { ApiError, fail, requireUser } from "@/lib/api-helpers";
import { driverCanReadDelivery } from "@/lib/constants";
import { readPodFile } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/pod/[id] — serve a proof-of-delivery file.
 * Private: only admins of the owning organization or drivers who may still
 * read the delivery (see driverCanReadDelivery) may view it — a driver whose
 * attempt failed and was reassigned can't see the next driver's signature.
 * Never exposed on the public tracking page.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const pod = await db.proofOfDelivery.findUnique({
      where: { id },
      include: {
        delivery: { include: { assignments: { select: { driverId: true, active: true, outcome: true, assignedAt: true } } } },
      },
    });
    if (!pod || pod.delivery.organizationId !== user.organizationId) {
      throw new ApiError(404, "Not found");
    }
    if (user.role !== "ADMIN" && !driverCanReadDelivery(pod.delivery.assignments, user.id)) {
      throw new ApiError(403, "You are not assigned to this delivery");
    }

    let data: Buffer;
    try {
      data = await readPodFile(pod.fileKey);
    } catch {
      throw new ApiError(404, "Proof file missing from storage");
    }

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": pod.mimeType,
        "Content-Disposition": `inline; filename="${pod.fileName}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
