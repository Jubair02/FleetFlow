import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";
import { noteSchema, firstError } from "@/lib/validation";
import { TX_OPTIONS, lockDelivery } from "@/lib/delivery";
import { auditData } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

// POST /api/deliveries/[id]/note — append a note to the event history.
// Admins may mark notes as customer-visible (shown on the tracking page).
// Drivers may only note deliveries they currently hold.
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const parsed = noteSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { note, customerVisible } = parsed.data;
    // only admins may publish customer-visible notes
    const visible = user.role === "ADMIN" ? customerVisible : false;

    const event = await db.$transaction(async (tx) => {
      await lockDelivery(tx, id, user.organizationId);
      const delivery = await tx.delivery.findUniqueOrThrow({
        where: { id },
        include: { assignments: { where: { active: true } } },
      });

      if (user.role !== "ADMIN") {
        const mine = delivery.assignments.some((a) => a.driverId === user.id);
        if (!mine) throw new ApiError(403, "You can only add notes to your own deliveries");
      }

      const created = await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          eventType: "NOTE",
          actorId: user.id,
          actorName: user.name,
          note,
          customerVisible: visible,
        },
      });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId, actorId: user.id, actorName: user.name,
          action: "NOTE_ADDED", entityType: "Delivery", entityId: delivery.id,
          detail: { trackingCode: delivery.trackingCode, eventId: created.id, customerVisible: visible },
        }),
      });
      return created;
    }, TX_OPTIONS);

    return ok({ success: true, eventId: event.id });
  } catch (e) {
    return fail(e);
  }
}
