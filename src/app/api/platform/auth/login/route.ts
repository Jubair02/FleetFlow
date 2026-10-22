import { fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { authenticate } from "@/lib/login-service";
import { parseBody, platformLoginSchema, toAdminInfo } from "@/lib/platform-service";

// POST /api/platform/auth/login {email, password} → { admin }
// Kept for API clients; the app uses the shared /api/auth/login. Same
// implementation, restricted to staff accounts (company credentials → 401).
export async function POST(req: Request) {
  try {
    const { email, password } = parseBody(platformLoginSchema, await readJson<unknown>(req));
    const result = await authenticate(email, password, clientIp(req), { scope: "platform" });
    if (result.kind !== "platform") throw new Error("unreachable: platform scope returned a tenant login");
    return ok({ admin: toAdminInfo(result.admin) });
  } catch (e) {
    return fail(e);
  }
}
