import { db } from "@/lib/db";
import { createSession, getDummyHash, verifyPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { loginSchema, firstError } from "@/lib/validation";
import { clearFailures, recordFailure, retryAfter } from "@/lib/rate-limit";
import { clientIp, sessionUserDto } from "@/lib/account";

export async function POST(req: Request) {
  try {
    const body = await readJson<unknown>(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const email = parsed.data.email.toLowerCase().trim();
    const { password } = parsed.data;

    // Throttle per account and per client so neither guessing nor CPU flooding scales.
    const keys = [`email:${email}`, `ip:${clientIp(req)}`];
    const wait = Math.max(...keys.map(retryAfter));
    if (wait > 0) {
      throw new ApiError(429, `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
    }

    const user = await db.user.findUnique({
      where: { email },
      include: { driverProfile: true, organization: { select: { id: true, name: true, status: true } } },
    });
    // Always run scrypt so unknown emails take as long as known ones.
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !passwordOk) {
      keys.forEach(recordFailure);
      throw new ApiError(401, "Invalid email or password");
    }
    clearFailures(keys[0]); // only the account key — a valid login must not reset the per-client counter
    if (user.organization.status !== "ACTIVE") {
      throw new ApiError(403, "Your company's FleetFlow account is suspended. Contact FleetFlow support.");
    }
    if (!user.active) {
      throw new ApiError(403, "This account has been deactivated. Contact your dispatcher.");
    }
    await createSession(user.id);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    return ok({ user: sessionUserDto(user) });
  } catch (e) {
    return fail(e);
  }
}
