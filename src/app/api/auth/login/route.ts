import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { loginSchema, firstError } from "@/lib/validation";
import { clientIp, sessionUserDto } from "@/lib/account";
import { authenticate } from "@/lib/login-service";

// POST /api/auth/login — the single sign-in endpoint for every account type.
// → { kind: "tenant", user, redirectTo: "/" }
//   | { kind: "platform", mfa: "enroll" | "verify", redirectTo: "/platform" }
// Staff then complete the authenticator step (/api/platform/auth/mfa/*) before
// /platform accepts the session.
// The destination comes from the server-verified account, never from the request.
export async function POST(req: Request) {
  try {
    const parsed = loginSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const result = await authenticate(parsed.data.email, parsed.data.password, clientIp(req));
    return result.kind === "platform"
      ? ok({ kind: "platform", mfa: result.mfa, redirectTo: result.redirectTo })
      : ok({ kind: "tenant", user: sessionUserDto(result.user), redirectTo: result.redirectTo });
  } catch (e) {
    return fail(e);
  }
}
