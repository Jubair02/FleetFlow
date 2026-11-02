import { z } from "zod";
import { ApiError, fail, ok, readJson, requireStaff } from "@/lib/api-helpers";
import { firstError } from "@/lib/validation";
import { retryOrganizationOutbox } from "@/lib/notify";

// { ids: [...] } retries specific emails/SMS; { allFailed: true } retries every retryable one.
const retrySchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(50, "Too many messages at once").optional(),
    allFailed: z.boolean().optional(),
  })
  .refine((v) => !!v.ids?.length || v.allFailed === true, { message: "Pass ids or allFailed: true" });

// POST /api/notifications/retry — re-send FAILED (and stuck PENDING/SENDING) emails
// and SMS of the caller's organization (admins and dispatchers). Rows that
// reached the attempt limit stay FAILED.
export async function POST(req: Request) {
  try {
    const user = await requireStaff();
    const parsed = retrySchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { ids, allFailed } = parsed.data;

    const summary = await retryOrganizationOutbox(user.organizationId, allFailed ? undefined : ids);
    return ok({ success: true, ...summary });
  } catch (e) {
    return fail(e);
  }
}
