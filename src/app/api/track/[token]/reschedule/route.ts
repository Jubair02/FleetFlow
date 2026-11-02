import { rescheduleRequestSchema } from "@/lib/customer-feedback";
import { handlePublicFeedback, requestReschedule } from "@/lib/customer-feedback-service";

type Params = { params: Promise<{ token: string }> };

/**
 * POST /api/track/[token]/reschedule — public: the recipient asks for another
 * delivery day { date: "YYYY-MM-DD" (tomorrow … +14 days, company timezone),
 * window: ANY | MORNING | AFTERNOON | EVENING, note? ≤ 300 chars }.
 * Only while the delivery is pending, assigned or failed, one request at a
 * time and at most 3 per delivery. Staff answer it from the delivery
 * (POST /api/deliveries/[id]/reschedule). Limited per tracking link + IP.
 */
export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  return handlePublicFeedback(req, token, "reschedule", (body) => rescheduleRequestSchema.safeParse(body), (input) => requestReschedule(token, input));
}
