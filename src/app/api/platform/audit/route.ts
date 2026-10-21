import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-helpers";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { AUDIT_PAGE_SIZE, auditListQuery, paged, parseQuery, toAuditRow } from "@/lib/platform-service";

// GET /api/platform/audit?action=&organizationId=&page= → Paged<PlatformAuditRow>
export async function GET(req: Request) {
  try {
    await requirePlatformAdmin();
    const q = parseQuery(auditListQuery, new URL(req.url).searchParams, ["action", "organizationId", "page"]);

    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(q.action ? { action: { contains: q.action, mode: "insensitive" } } : {}),
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
    };
    const [total, rows] = await Promise.all([
      db.platformAuditLog.count({ where }),
      db.platformAuditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * AUDIT_PAGE_SIZE,
        take: AUDIT_PAGE_SIZE,
      }),
    ]);

    const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
    const orgs = orgIds.length ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(orgs.map((o) => [o.id, o.name]));

    return ok(paged(rows.map((r) => toAuditRow(r, names)), total, q.page, AUDIT_PAGE_SIZE));
  } catch (e) {
    return fail(e);
  }
}
