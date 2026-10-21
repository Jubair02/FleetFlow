import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-helpers";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { USER_PAGE_SIZE, USER_ROW_SELECT, paged, parseQuery, toUserRow, userListQuery } from "@/lib/platform-service";

// GET /api/platform/users?search=&role=&status=&organizationId=&page=
// Explicit select: password hashes never leave the database.
export async function GET(req: Request) {
  try {
    await requirePlatformAdmin();
    const q = parseQuery(userListQuery, new URL(req.url).searchParams, ["search", "role", "status", "organizationId", "page"]);

    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { active: q.status === "active" } : {}),
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }] }
        : {}),
    };

    const [total, users] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        select: USER_ROW_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * USER_PAGE_SIZE,
        take: USER_PAGE_SIZE,
      }),
    ]);

    return ok(paged(users.map(toUserRow), total, q.page, USER_PAGE_SIZE));
  } catch (e) {
    return fail(e);
  }
}
