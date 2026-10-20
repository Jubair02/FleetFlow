import { db } from "@/lib/db";
import { fail, ok, requireAdmin } from "@/lib/api-helpers";
import type { Prisma } from "@prisma/client";

// GET /api/audit?page=&entityType=&action= — org audit trail (admin)
export async function GET(req: Request) {
  try {
    const user = await requireAdmin();
    const url = new URL(req.url);
    const q = (k: string) => url.searchParams.get(k)?.trim() || "";
    const page = Math.max(1, parseInt(q("page") || "1", 10) || 1);
    const pageSize = 30;

    const where: Prisma.AuditLogWhereInput = { organizationId: user.organizationId };
    if (q("entityType")) where.entityType = q("entityType");
    if (q("action")) where.action = { contains: q("action") };

    const [total, items] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
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
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    return fail(e);
  }
}
