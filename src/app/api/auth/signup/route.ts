import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { ApiError, fail, ok, readJson } from "@/lib/api-helpers";
import { signupSchema, firstError } from "@/lib/validation";
import { recordFailure, retryAfter } from "@/lib/rate-limit";
import { clientIp, sessionUserDto } from "@/lib/account";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { getDefaultPlan, listPrice } from "@/lib/plans";

// Self-service sign-up is on by default; set ALLOW_SIGNUP=false to close it.
function signupEnabled(): boolean {
  return process.env.ALLOW_SIGNUP !== "false";
}

// GET /api/auth/signup — lets the sign-up page say up front whether it's open.
export async function GET() {
  return ok({ enabled: signupEnabled() });
}

// POST /api/auth/signup — create a company on the default plan (set in the
// platform console; "trial" out of the box) and its first admin, then sign in.
export async function POST(req: Request) {
  try {
    if (!signupEnabled()) {
      throw new ApiError(403, "Self-service sign-up is closed. Contact FleetFlow to open an account.");
    }

    // Every attempt counts (successful or not): "signup:" keys allow 5 per 15 minutes per client.
    const key = `signup:${clientIp(req)}`;
    const wait = retryAfter(key);
    if (wait > 0) {
      throw new ApiError(429, `Too many sign-up attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
    }
    recordFailure(key);

    const parsed = signupSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const data = parsed.data;

    // Hash outside the transaction so the connection isn't held during scrypt.
    const passwordHash = await hashPassword(data.password);

    let userId: string;
    try {
      userId = await db.$transaction(async (tx) => {
        const plan = await getDefaultPlan(tx);
        // Monthly cycle at today's list price (null = free, e.g. trial).
        const subscriptionPriceBdt = listPrice(plan, "MONTHLY");
        const org = await tx.organization.create({
          data: {
            name: data.companyName,
            plan: plan.code,
            billingCycle: "MONTHLY",
            subscriptionPriceBdt,
            planAssignedAt: new Date(),
            phone: data.phone || null,
            contactEmail: data.email,
            timezone: DEFAULT_TIMEZONE,
          },
        });
        const user = await tx.user.create({
          data: {
            organizationId: org.id,
            name: data.name,
            email: data.email,
            passwordHash,
            role: "ADMIN",
            lastLoginAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: auditData({
            organizationId: org.id, actorId: user.id, actorName: user.name,
            action: "ORGANIZATION_CREATED", entityType: "Organization", entityId: org.id,
            detail: { companyName: data.companyName, adminEmail: data.email, plan: plan.code, billingCycle: "MONTHLY", priceBdt: subscriptionPriceBdt },
          }),
        });
        return user.id;
      }, TX_OPTIONS);
    } catch (e) {
      // Emails are globally unique; don't reveal whether the account exists.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(409, "This email can't be used for a new account");
      }
      throw e;
    }

    await createSession(userId);
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { driverProfile: true, organization: { select: { id: true, name: true } } },
    });
    return ok({ user: sessionUserDto(user) }, 201);
  } catch (e) {
    return fail(e);
  }
}
