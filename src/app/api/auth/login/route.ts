import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { loginSchema, firstError } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const body = await readJson<unknown>(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const { email, password } = parsed.data;

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { driverProfile: true, organization: { select: { id: true, name: true } } },
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new ApiError(401, "Invalid email or password");
    }
    if (!user.active) {
      throw new ApiError(403, "This account has been deactivated. Contact your dispatcher.");
    }
    await createSession(user.id);

    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: user.organization.name,
        driverProfile: user.driverProfile,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
