import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { createInvoice, createInvoiceSchema, toPlatformInvoiceRow } from "@/lib/billing";
import { INVOICE_STATUSES, type PlatformInvoicesData } from "@/lib/billing-types";
import { requirePlatformAdmin } from "@/lib/platform-auth";
import { parseBody, parseQuery } from "@/lib/platform-service";

const blank = (v: unknown) => (v === null || v === "" ? undefined : v);
const listQuery = z.object({
  organizationId: z.preprocess(blank, z.string().trim().max(64).optional()),
  status: z.preprocess(blank, z.enum(INVOICE_STATUSES, "Invalid status").optional()),
  /** "1" = only OPEN invoices with a reported payment (Payments to verify). */
  reported: z.preprocess(blank, z.enum(["1", "true"], "Invalid reported flag").optional()),
  take: z.preprocess(blank, z.coerce.number().int().min(1).max(200).default(100)),
});

// GET /api/platform/invoices?organizationId=&status=&reported=1 → PlatformInvoicesData
export async function GET(req: Request) {
  try {
    await requirePlatformAdmin();
    const q = parseQuery(listQuery, new URL(req.url).searchParams, ["organizationId", "status", "reported", "take"]);
    const where: Prisma.InvoiceWhereInput = {
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.reported ? { status: "OPEN", reportedAt: { not: null } } : q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db.invoice.findMany({
        where,
        include: { organization: { select: { name: true, paidUntil: true } } },
        orderBy: q.reported ? [{ reportedAt: "asc" }, { id: "asc" }] : [{ issuedAt: "desc" }, { id: "desc" }],
        take: q.take,
      }),
      db.invoice.count({ where }),
    ]);
    const now = new Date();
    const body: PlatformInvoicesData = { invoices: rows.map((r) => toPlatformInvoiceRow(r, now)), total };
    return ok(body);
  } catch (e) {
    return fail(e);
  }
}

// POST /api/platform/invoices { organizationId, planCode, billingCycle, amountBdt, periodStart?, dueAt?, notes? } → { invoice } (201)
export async function POST(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const input = parseBody(createInvoiceSchema, await readJson<unknown>(req));
    const invoice = await createInvoice(admin, input, clientIp(req));
    return ok({ invoice: { id: invoice.id, number: invoice.number } }, 201);
  } catch (e) {
    return fail(e);
  }
}
