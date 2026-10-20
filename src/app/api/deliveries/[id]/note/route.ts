import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireUser } from "@/lib/api-helpers";
import { noteSchema, firstError } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

// POST /api/deliveries/[id]/note — append a note to the event history.
// Admins may mark notes as customer-visible (shown on the tracking page).
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const parsed = noteSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { note, customerVisible } = parsed.data;

    const delivery = await db.delivery.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { assignments: { where: { active: true } } },
    });
    if (!delivery) throw new ApiError(404, "Delivery not found");

    if (user.role !== "ADMIN") {
      const mine = delivery.assignments.some((a) => a.driverId === user.id);
      if (!mine) throw new ApiError(403, "You can only add notes to your own deliveries");
    }
    // only admins may publish customer-visible notes
    const visible = user.role === "ADMIN" ? customerVisible : false;

    const event = await db.deliveryEvent.create({
      data: {
        deliveryId: delivery.id,
        eventType: "NOTE",
        actorId: user.id,
        actorName: user.name,
        note,
        customerVisible: visible,
      },
    });

    return ok({ success: true, eventId: event.id });
  } catch (e) {
    return fail(e);
  }
}
