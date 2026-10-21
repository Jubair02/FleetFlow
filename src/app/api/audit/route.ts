import { db } from "@/lib/db";
import { ApiError, fail, ok, requireAdmin } from "@/lib/api-helpers";
import type { Prisma } from "@prisma/client";

const PAGE_SIZE = 30;
const MAX_PAGE = 10_000;

// GET /api/audit?page=&entityType=&action= — org audit trail (admin)
export async function GET(req: Request) {
  try {
    const user = await requireAdmin();
    const url = new URL(req.url);
    const q = (k: string) => url.searchParams.get(k)?.trim() || "";

    const rawPage = q("page") || "1";
    if (!/^\d{1,6}$/.test(rawPage)) throw new ApiError(400, "page must be a positive integer");
    const page = Number(rawPage);
    if (page < 1 || page > MAX_PAGE) throw new ApiError(400, `page must be between 1 and ${MAX_PAGE}`);

    const entityType = q("entityType");
    const action = q("action");
    if (entityType.length > 64 || action.length > 100) throw new ApiError(400, "Filter value is too long");

    const where: Prisma.AuditLogWhereInput = { organizationId: user.organizationId };
    if (entityType) where.entityType = entityType;
    if (action) where.action = { contains: action, mode: "insensitive" };

    const [total, items] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    return ok({
      items: items.map((a) => ({
        id: a.id,
        actorName: a.actorName ?? "System",
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        detail: a.detail,
        createdAt: a.createdAt.toISOString(),
      })),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  } catch (e) {
    return fail(e);
  }
}
