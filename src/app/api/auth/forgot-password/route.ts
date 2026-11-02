import { after } from "next/server";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { bestEffort } from "@/lib/notify";
import { FORGOT_PASSWORD_RESPONSE, findResettableUser, issuePasswordReset } from "@/lib/password-reset";
import { recordFailure, retryAfter } from "@/lib/rate-limit";
import { firstError, forgotPasswordSchema } from "@/lib/validation";

// POST /api/auth/forgot-password { email } → always the same 200 body.
// Whether or not the account exists (or is active / its company suspended),
// the response and its timing are the same: the link is created and emailed
// after the response is sent. Every request counts against the limits
// ("forgot-ip:" 20 and "forgot-email:" 3 per 15 minutes).
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const ipKey = `forgot-ip:${ip}`;
    const ipWait = await retryAfter(ipKey);
    if (ipWait > 0) {
      throw new ApiError(429, `Too many password reset requests. Try again in ${Math.ceil(ipWait / 60)} minute(s).`);
    }
    await recordFailure(ipKey);

    const parsed = forgotPasswordSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { email } = parsed.data;

    // Per mailbox: past the limit, quietly send nothing (same answer, no flood of emails).
    const emailKey = `forgot-email:${email}`;
    const [emailWait, user] = await Promise.all([retryAfter(emailKey), findResettableUser(email)]);
    if (emailWait === 0) {
      await recordFailure(emailKey);
      if (user) after(() => bestEffort("password reset email", () => issuePasswordReset(user, ip)));
    }
    return ok(FORGOT_PASSWORD_RESPONSE);
  } catch (e) {
    return fail(e);
  }
}
