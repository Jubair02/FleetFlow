import { ratingSchema } from "@/lib/customer-feedback";
import { handlePublicFeedback, submitRating } from "@/lib/customer-feedback-service";

type Params = { params: Promise<{ token: string }> };

/**
 * POST /api/track/[token]/rating — public: the recipient rates a delivered
 * delivery once (1–5 stars + optional comment ≤ 500 chars) within 14 days of
 * delivery, if the company allows ratings. A second rating is refused (409).
 * Limited per tracking link + client IP. Errors carry a `code` the tracking
 * page translates (disabled, not_delivered, already_rated, expired, …).
 */
export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  return handlePublicFeedback(req, token, "rate", (body) => ratingSchema.safeParse(body), (input) => submitRating(token, input));
}
