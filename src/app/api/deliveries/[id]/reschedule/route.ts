import { ApiError, fail, ok, readJson, requireStaff } from "@/lib/api-helpers";
import { firstError } from "@/lib/validation";
import { rescheduleResolveSchema } from "@/lib/customer-feedback";
import { resolveReschedule } from "@/lib/customer-feedback-service";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/deliveries/[id]/reschedule — answer the customer's pending
 * reschedule request (admin/dispatcher).
 * { action: "accept" | "decline", expectedAt?: ISO, note?: message to the customer }
 *
 * accept: sets expectedAt (default: end of the requested window, or the
 * requested day for "any time"); a FAILED delivery is reopened as CREATED so
 * it can be dispatched again. Only while CREATED / ASSIGNED / FAILED.
 * decline: records the answer. Both add a customer-visible timeline entry,
 * an audit entry and (plan permitting) email the customer.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireStaff();
    const { id } = await params;
    const parsed = rescheduleResolveSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    return ok(await resolveReschedule(user, id, parsed.data));
  } catch (e) {
    return fail(e);
  }
}
