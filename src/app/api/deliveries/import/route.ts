import { createHash } from "crypto";
import { after } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { assertPlanLimit } from "@/lib/plans";
import { generateTrackingCode, generateTrackingToken } from "@/lib/delivery";
import { auditData, bestEffort, sendCustomerTrackingEmail } from "@/lib/notify";
import { CSV_MAX_BYTES, normalizeCsvText } from "@/lib/csv";
import {
  buildImportPlan,
  detectDuplicates,
  ImportFileError,
  importTotals,
  LIKELY_DUPLICATE_DAYS,
  orderRefsToCheck,
  type ExistingDelivery,
  type ImportOptions,
  type ImportRow,
} from "@/lib/delivery-import";
import { DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/timezone";

// ─────────────────────────────────────────────────────────────
// POST /api/deliveries/import — bulk CSV import (admin).
// Body: { fileName, csv, mode: "preview" | "commit" }.
//
// The server ALWAYS re-parses and re-validates the CSV text; nothing the
// browser computed is trusted. "preview" is read-only. "commit" imports the
// valid, non-duplicate rows all-or-nothing:
//
//   one interactive transaction (long timeout, see IMPORT_TX_OPTIONS):
//     1. assertPlanLimit — locks the Organization row FOR UPDATE. Single
//        creates take the same lock, so from here on nobody else can add
//        deliveries to this org until we commit.
//     2. re-run the duplicate lookups under that lock (the count can only
//        shrink, so the limit checked in step 1 still holds)
//     3. create the ImportBatch — @@unique(organizationId, fileHash) makes a
//        second import of the same file fail with P2002 → 409
//     4. pick tracking codes that are unique within the batch and not in the
//        DB, then createManyAndReturn the deliveries in chunks of 250 rows
//        (bounded statement size / bind parameters; ~4 round trips for 1000)
//     5. createMany one CREATED DeliveryEvent per delivery, same chunking
//     6. one AuditLog row DELIVERIES_IMPORTED with the counts
//   A tracking code/token race with a concurrent create (P2002) aborts the
//   Postgres transaction, so the WHOLE transaction is retried (max 3) with
//   fresh codes. No partial imports are possible.
//
// After commit, customer tracking emails are sent best-effort via after()
// with small concurrency, so the response isn't held up.
// ─────────────────────────────────────────────────────────────

export const maxDuration = 120;

const CHUNK_SIZE = 250;
const MAX_COMMIT_ATTEMPTS = 3;
const EMAIL_CONCURRENCY = 4;
/** 1000 rows ≈ 10 round trips to Neon; leave plenty of headroom. */
const IMPORT_TX_OPTIONS = { maxWait: 15_000, timeout: 90_000 } as const;

const bodySchema = z.object({
  fileName: z.string().trim().min(1, "File name is required").max(255),
  csv: z.string().min(1, "The file is empty"),
  mode: z.enum(["preview", "commit"]),
});

function isTrackingCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return /trackingCode|trackingToken/i.test(fields);
}

function isFileHashConflict(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return /fileHash/i.test(fields) || /ImportBatch/i.test(String(e.meta?.modelName ?? ""));
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Db = Prisma.TransactionClient | typeof db;

/** Non-cancelled deliveries that could be duplicates of the plan's rows. */
async function loadExisting(client: Db, organizationId: string, rows: ImportRow[], now: Date): Promise<ExistingDelivery[]> {
  const refs = orderRefsToCheck(rows.filter((r) => r.status === "valid"));
  const since = new Date(now.getTime() - LIKELY_DUPLICATE_DAYS * 24 * 60 * 60 * 1000);
  const select = { trackingCode: true, externalRef: true, recipientPhone: true, deliveryAddress: true, expectedAt: true, createdAt: true } as const;
  const [byRef, recent] = await Promise.all([
    refs.length
      ? client.delivery.findMany({ where: { organizationId, status: { not: "CANCELLED" }, externalRef: { in: refs } }, select })
      : Promise.resolve([]),
    client.delivery.findMany({
      where: { organizationId, status: { not: "CANCELLED" }, createdAt: { gte: since }, expectedAt: { not: null } },
      select,
      orderBy: { createdAt: "desc" },
      take: 20_000,
    }),
  ]);
  return [...byRef, ...recent];
}

async function alreadyImported(organizationId: string, fileHash: string) {
  const batch = await db.importBatch.findUnique({
    where: { organizationId_fileHash: { organizationId, fileHash } },
    select: { createdAt: true, createdByName: true },
  });
  return batch ? { at: batch.createdAt.toISOString(), by: batch.createdByName ?? "someone" } : null;
}

/** "21 Oct 2026, 14:05" in the organization's timezone. */
function formatInTz(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function alreadyImportedError(prev: { at: string; by: string }, timezone: string): ApiError {
  return new ApiError(409, `This file was already imported on ${formatInTz(prev.at, timezone)} by ${prev.by}`);
}

/** Tracking codes unique within the batch and not already in the database. */
async function uniqueTrackingCodes(tx: Prisma.TransactionClient, count: number): Promise<string[]> {
  const codes = new Set<string>();
  for (let round = 0; round < 10 && codes.size < count; round++) {
    const fresh = new Set<string>();
    while (fresh.size < count - codes.size) {
      const c = generateTrackingCode();
      if (!codes.has(c)) fresh.add(c);
    }
    const taken = await tx.delivery.findMany({ where: { trackingCode: { in: [...fresh] } }, select: { trackingCode: true } });
    const takenSet = new Set(taken.map((t) => t.trackingCode));
    for (const c of fresh) if (!takenSet.has(c)) codes.add(c);
  }
  if (codes.size < count) throw new ApiError(503, "Couldn't allocate tracking codes — please retry");
  return [...codes];
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > CSV_MAX_BYTES * 3) throw new ApiError(413, "This file is too large — the limit is 1 MB per import");

    const parsedBody = bodySchema.safeParse(await readJson<unknown>(req));
    if (!parsedBody.success) throw new ApiError(400, parsedBody.error.issues[0]?.message ?? "Invalid input");
    const { fileName, csv, mode } = parsedBody.data;
    if (!/\.csv$/i.test(fileName)) throw new ApiError(400, "Only .csv files can be imported");

    const org = await db.organization.findUnique({
      where: { id: user.organizationId },
      select: { defaultPickupAddress: true, timezone: true },
    });
    if (!org) throw new ApiError(404, "Organization not found");
    const timezone = org.timezone && isValidTimezone(org.timezone) ? org.timezone : DEFAULT_TIMEZONE;
    const now = new Date();
    const opts: ImportOptions = { defaultPickupAddress: org.defaultPickupAddress, timezone, now };

    let plan;
    try {
      plan = buildImportPlan(csv, opts);
    } catch (e) {
      if (e instanceof ImportFileError) throw new ApiError(400, e.message);
      throw e;
    }
    const fileHash = createHash("sha256").update(normalizeCsvText(csv), "utf8").digest("hex");
    const rows = detectDuplicates(plan.rows, await loadExisting(db, user.organizationId, plan.rows, now), opts);
    const totals = importTotals(rows);

    if (mode === "preview") {
      return ok({
        fileHash,
        fileName,
        timezone,
        alreadyImported: await alreadyImported(user.organizationId, fileHash),
        fileWarnings: plan.fileWarnings,
        totals,
        rows,
      });
    }

    // ── commit ──────────────────────────────────────────────
    const prev = await alreadyImported(user.organizationId, fileHash);
    if (prev) throw alreadyImportedError(prev, timezone);
    if (totals.valid === 0) throw new ApiError(400, "There are no valid rows to import — fix the errors and upload the file again");

    const commitOnce = () =>
      db.$transaction(async (tx) => {
        await assertPlanLimit(tx, user.organizationId, "monthlyDeliveries", totals.valid);
        const finalRows = detectDuplicates(plan.rows, await loadExisting(tx, user.organizationId, plan.rows, now), opts);
        const finalTotals = importTotals(finalRows);
        const toCreate = finalRows.filter((r) => r.status === "valid");
        if (toCreate.length === 0) throw new ApiError(409, "These deliveries were just created by someone else — nothing left to import");

        const batch = await tx.importBatch.create({
          data: {
            organizationId: user.organizationId,
            fileName,
            fileHash,
            rowCount: finalTotals.rows,
            importedCount: toCreate.length,
            skippedCount: finalTotals.duplicates,
            failedCount: finalTotals.invalid,
            createdById: user.id,
            createdByName: user.name,
          },
        });

        const codes = await uniqueTrackingCodes(tx, toCreate.length);
        const created: { id: string; trackingCode: string; trackingToken: string; recipientName: string; recipientEmail: string | null }[] = [];
        for (const part of chunks(toCreate.map((r, i) => ({ r, code: codes[i] })), CHUNK_SIZE)) {
          const inserted = await tx.delivery.createManyAndReturn({
            data: part.map(({ r, code }) => ({
              organizationId: user.organizationId,
              trackingCode: code,
              trackingToken: generateTrackingToken(),
              recipientName: r.data.recipientName,
              recipientPhone: r.data.recipientPhone,
              pickupAddress: r.data.pickupAddress,
              deliveryAddress: r.data.deliveryAddress,
              instructions: r.data.instructions,
              externalRef: r.data.externalRef,
              recipientEmail: r.data.recipientEmail,
              priority: r.data.priority,
              status: "CREATED",
              expectedAt: r.data.expectedAt ? new Date(r.data.expectedAt) : null,
              importBatchId: batch.id,
            })),
            select: { id: true, trackingCode: true, trackingToken: true, recipientName: true, recipientEmail: true },
          });
          created.push(...inserted);
        }

        const eventNote = `Imported from ${fileName}`.slice(0, 500);
        for (const part of chunks(created, CHUNK_SIZE)) {
          await tx.deliveryEvent.createMany({
            data: part.map((d) => ({
              deliveryId: d.id,
              eventType: "CREATED",
              actorId: user.id,
              actorName: user.name,
              note: eventNote,
              customerVisible: true,
            })),
          });
        }

        await tx.auditLog.create({
          data: auditData({
            organizationId: user.organizationId,
            actorId: user.id,
            actorName: user.name,
            action: "DELIVERIES_IMPORTED",
            entityType: "ImportBatch",
            entityId: batch.id,
            detail: {
              fileName,
              rows: finalTotals.rows,
              imported: created.length,
              skipped: finalTotals.duplicates,
              failed: finalTotals.invalid,
            },
          }),
        });

        return { batchId: batch.id, created, totals: finalTotals };
      }, IMPORT_TX_OPTIONS);

    let result: Awaited<ReturnType<typeof commitOnce>> | null = null;
    for (let attempt = 1; !result; attempt++) {
      try {
        result = await commitOnce();
      } catch (e) {
        if (attempt < MAX_COMMIT_ATTEMPTS && isTrackingCollision(e)) continue;
        if (isFileHashConflict(e)) {
          const again = await alreadyImported(user.organizationId, fileHash);
          throw again ? alreadyImportedError(again, timezone) : new ApiError(409, "This file was already imported");
        }
        throw e;
      }
    }

    const toEmail = result.created.filter((d) => d.recipientEmail);
    if (toEmail.length) {
      after(async () => {
        const queue = [...toEmail];
        const worker = async () => {
          for (let d = queue.shift(); d; d = queue.shift()) {
            const delivery = d;
            await bestEffort("customer tracking email (import)", () =>
              sendCustomerTrackingEmail({
                organizationId: user.organizationId,
                deliveryId: delivery.id,
                trackingCode: delivery.trackingCode,
                trackingToken: delivery.trackingToken,
                recipientName: delivery.recipientName,
                recipientEmail: delivery.recipientEmail,
              })
            );
          }
        };
        await Promise.all(Array.from({ length: Math.min(EMAIL_CONCURRENCY, queue.length) }, worker));
      });
    }

    return ok(
      {
        batchId: result.batchId,
        imported: result.created.length,
        skipped: result.totals.duplicates,
        failed: result.totals.invalid,
        emailsQueued: toEmail.length,
      },
      201
    );
  } catch (e) {
    return fail(e);
  }
}
