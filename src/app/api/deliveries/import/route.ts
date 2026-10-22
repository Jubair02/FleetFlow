import { createHash } from "crypto";
import { after } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import type { SessionUser } from "@/lib/auth";
import { assertFeature, assertPlanLimit, getOrgPlan, getUsage } from "@/lib/plans";
import { generateTrackingCode, generateTrackingToken } from "@/lib/delivery";
import { auditData, bestEffort, sendCustomerTrackingEmail } from "@/lib/notify";
import { normalizeCsvText } from "@/lib/csv";
import {
  applyLikelyDuplicateOverrides,
  buildImportPlan,
  canonicalRowsJson,
  compressRowNumbers,
  detectDuplicates,
  expandRowNumbers,
  ImportFileError,
  importTotals,
  LIKELY_DUPLICATE_DAYS,
  orderRefsToCheck,
  planFromMappedRows,
  type ExistingDelivery,
  type ImportOptions,
  type ImportPlan,
  type ImportRow,
} from "@/lib/delivery-import";
import {
  MAX_COMMIT_ROWS,
  MAX_IMPORT_ROWS,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type ImportSource,
} from "@/lib/import-contract";
import { DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/timezone";

// ─────────────────────────────────────────────────────────────
// POST /api/deliveries/import — bulk delivery import (admin).
// Requires the plan feature csv_import (403 otherwise, checked first, for
// every body shape and mode). Contract: src/lib/import-contract.ts.
//
// Two body shapes (told apart by the presence of `rows`):
//   • mapped rows  { mode, source: "CSV"|"PASTE", fileName, rows: MappedRow[],
//                    idempotencyKey?, allowLikelyDuplicates? }
//     preview ≤ MAX_IMPORT_ROWS rows; commit ≤ MAX_COMMIT_ROWS rows (one
//     atomic chunk) and requires an idempotencyKey.
//   • legacy CSV   { mode, fileName, csv }  (≤ 1 MB / 1000 rows, server-side
//                    parsing + header auto-mapping), unchanged behaviour.
//
// The server ALWAYS re-validates (validateRow, same rules as manual
// creation) and re-runs duplicate detection; nothing the browser computed
// is trusted. "preview" is read-only. "commit" imports the valid,
// non-duplicate rows all-or-nothing:
//
//   one interactive transaction (long timeout, see IMPORT_TX_OPTIONS):
//     1. assertPlanLimit — locks the Organization row FOR UPDATE. Single
//        creates take the same lock, so from here on nobody else can add
//        deliveries to this org until we commit.
//     2. re-run the duplicate lookups under that lock and re-apply the
//        client's "import anyway" choices (likely duplicates only — exact
//        order_ref duplicates can never be overridden). If that leaves MORE
//        rows than were checked in step 1 the limit is checked again.
//     3. create the ImportBatch — @@unique(organizationId, fileHash) makes a
//        second import of the same content fail with P2002 → 409, and
//        @@unique(organizationId, idempotencyKey) makes a concurrent retry
//        of the same chunk fail with P2002 → replay of the stored result
//     4. pick tracking codes that are unique within the batch and not in the
//        DB, then createManyAndReturn the deliveries in chunks of 250 rows
//     5. createMany one CREATED DeliveryEvent per delivery, same chunking
//     6. one AuditLog row DELIVERIES_IMPORTED with source, counts and the
//        imported/skipped/failed row numbers (compact "2-40,42" form)
//   A tracking code/token race with a concurrent create (P2002) aborts the
//   Postgres transaction, so the WHOLE transaction is retried (max 3) with
//   fresh codes. No partial imports are possible.
//
// Idempotency (mapped commits): a retry with an idempotencyKey that was
// already committed returns the ORIGINAL result with replayed=true and
// status 200; nothing is imported twice. The row-number lists are read back
// from the batch's DELIVERIES_IMPORTED audit row (the schema has no column
// for them); counts come from the ImportBatch row. Reusing a key for
// different rows is a 409. A chunk with nothing to import writes nothing
// (no batch), returns 200, and is simply re-evaluated on retry.
//
// Fingerprints: mapped rows → sha256(canonicalRowsJson(rows)) (the chunk's
// rows on commit, all rows on preview), stored as ImportBatch.fileHash;
// legacy CSV → sha256 of the normalized file text.
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
/** 5000 mapped rows as JSON are ~2–4 MB with long addresses; legacy CSV text is ≤ 1 MB. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;
/** Longest cell accepted (the longest delivery field is 500 chars; leave room for errors to be reported per row). */
const MAX_CELL_CHARS = 2000;

const modeSchema = z.enum(["preview", "commit"], { error: 'mode must be "preview" or "commit"' });

const legacyBodySchema = z.object({
  fileName: z.string().trim().min(1, "File name is required").max(255),
  csv: z.string().min(1, "The file is empty"),
  mode: modeSchema,
});

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9:_-]{8,120}$/;

const mappedBodySchema = z.object({
  mode: modeSchema,
  source: z.enum(["CSV", "PASTE"], { error: 'source must be "CSV" or "PASTE"' }),
  fileName: z.string().trim().min(1, "File name is required").max(200, "File name must be at most 200 characters"),
  rows: z
    .array(
      z.object({
        rowNumber: z.number({ error: "Each row needs a row number" }).int().min(1).max(1_000_000),
        values: z.record(z.string(), z.string().max(MAX_CELL_CHARS, `A cell is longer than ${MAX_CELL_CHARS} characters`)),
      })
    )
    .min(1, "There are no rows to import")
    .max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} rows can be imported at once — split the import into smaller ones`),
  idempotencyKey: z
    .string()
    .regex(IDEMPOTENCY_KEY_RE, "idempotencyKey must be 8–120 characters of letters, digits, : _ or -")
    .optional(),
  allowLikelyDuplicates: z.array(z.number().int()).max(MAX_IMPORT_ROWS).optional(),
});
type MappedBody = z.infer<typeof mappedBodySchema>;

function uniqueTarget(e: unknown): string | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const target = e.meta?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

function isTrackingCollision(e: unknown): boolean {
  const fields = uniqueTarget(e);
  return fields !== null && /trackingCode|trackingToken/i.test(fields);
}

function isFileHashConflict(e: unknown): boolean {
  const fields = uniqueTarget(e);
  if (fields === null) return false;
  return /fileHash/i.test(fields) || (!/idempotencyKey/i.test(fields) && /ImportBatch/i.test(String((e as Prisma.PrismaClientKnownRequestError).meta?.modelName ?? "")));
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

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

const subjectOf = (source: ImportSource) => (source === "PASTE" ? "These rows were" : "This file was");

function alreadyImportedError(prev: { at: string; by: string }, timezone: string, source: ImportSource = "CSV"): ApiError {
  return new ApiError(409, `${subjectOf(source)} already imported on ${formatInTz(prev.at, timezone)} by ${prev.by}`);
}

/** Room left in this month's delivery allowance; null = unlimited. */
async function monthlyDeliveriesRemaining(organizationId: string, timezone: string): Promise<number | null> {
  const plan = await getOrgPlan(db, organizationId);
  const limit = plan.limits.monthlyDeliveries;
  if (limit === null) return null;
  const usage = await getUsage(db, organizationId, timezone);
  return Math.max(0, limit - usage.monthlyDeliveries);
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

// ── Organization context ─────────────────────────────────────

async function importOptions(organizationId: string): Promise<{ timezone: string; now: Date; opts: ImportOptions }> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { defaultPickupAddress: true, timezone: true },
  });
  if (!org) throw new ApiError(404, "Organization not found");
  const timezone = org.timezone && isValidTimezone(org.timezone) ? org.timezone : DEFAULT_TIMEZONE;
  const now = new Date();
  return { timezone, now, opts: { defaultPickupAddress: org.defaultPickupAddress, timezone, now } };
}

function planOrBadRequest(build: () => ImportPlan): ImportPlan {
  try {
    return build();
  } catch (e) {
    if (e instanceof ImportFileError) throw new ApiError(400, e.message);
    throw e;
  }
}

// ── Commit (shared by both body shapes) ──────────────────────

type CreatedDelivery = { id: string; trackingCode: string; trackingToken: string; recipientName: string; recipientEmail: string | null };

interface CommitInput {
  user: SessionUser;
  fileName: string;
  fileHash: string;
  source: ImportSource;
  idempotencyKey: string | null;
  /** validateRow output (before duplicate detection). */
  planRows: ImportRow[];
  allowLikelyDuplicates: number[];
  /** Valid rows counted before the lock (checked against the plan limit first). */
  expectedValid: number;
  opts: ImportOptions;
  now: Date;
  /** Legacy CSV: "everything became a duplicate under the lock" is a 409, as before. */
  emptyIsConflict: boolean;
}

interface CommitResult {
  /** null when nothing was left to import (nothing written). */
  batchId: string | null;
  created: CreatedDelivery[];
  rows: ImportRow[];
  importedRows: number[];
}

const rowNumbersWith = (rows: ImportRow[], status: ImportRow["status"]) => rows.filter((r) => r.status === status).map((r) => r.rowNumber);

function commitOnce(input: CommitInput): Promise<CommitResult> {
  const { user, fileName, fileHash, source, idempotencyKey, opts, now } = input;
  const organizationId = user.organizationId;
  return db.$transaction(async (tx) => {
    await assertPlanLimit(tx, organizationId, "monthlyDeliveries", input.expectedValid);
    const finalRows = applyLikelyDuplicateOverrides(
      detectDuplicates(input.planRows, await loadExisting(tx, organizationId, input.planRows, now), opts),
      input.allowLikelyDuplicates
    );
    const finalTotals = importTotals(finalRows);
    const toCreate = finalRows.filter((r) => r.status === "valid");
    if (toCreate.length === 0) {
      if (input.emptyIsConflict) throw new ApiError(409, "These deliveries were just created by someone else — nothing left to import");
      return { batchId: null, created: [], rows: finalRows, importedRows: [] };
    }
    // Only possible if an existing duplicate was cancelled meanwhile.
    if (toCreate.length > input.expectedValid) await assertPlanLimit(tx, organizationId, "monthlyDeliveries", toCreate.length);

    const batch = await tx.importBatch.create({
      data: {
        organizationId,
        fileName,
        fileHash,
        source,
        idempotencyKey,
        rowCount: finalTotals.rows,
        importedCount: toCreate.length,
        skippedCount: finalTotals.duplicates,
        failedCount: finalTotals.invalid,
        createdById: user.id,
        createdByName: user.name,
      },
    });

    const codes = await uniqueTrackingCodes(tx, toCreate.length);
    const created: CreatedDelivery[] = [];
    for (const part of chunks(toCreate.map((r, i) => ({ r, code: codes[i] })), CHUNK_SIZE)) {
      const inserted = await tx.delivery.createManyAndReturn({
        data: part.map(({ r, code }) => ({
          organizationId,
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

    const importedRows = toCreate.map((r) => r.rowNumber);
    await tx.auditLog.create({
      data: auditData({
        organizationId,
        actorId: user.id,
        actorName: user.name,
        action: "DELIVERIES_IMPORTED",
        entityType: "ImportBatch",
        entityId: batch.id,
        detail: {
          fileName,
          source,
          rows: finalTotals.rows,
          imported: created.length,
          skipped: finalTotals.duplicates,
          failed: finalTotals.invalid,
          emailsQueued: created.filter((d) => d.recipientEmail).length,
          // Read back by replayCommit() — see the header comment.
          ...(idempotencyKey ? { idempotencyKey } : {}),
          importedRows: compressRowNumbers(importedRows),
          skippedRows: compressRowNumbers(rowNumbersWith(finalRows, "duplicate")),
          failedRows: compressRowNumbers(rowNumbersWith(finalRows, "invalid")),
        },
      }),
    });

    return { batchId: batch.id, created, rows: finalRows, importedRows };
  }, IMPORT_TX_OPTIONS);
}

type CommitOutcome = { kind: "done"; result: CommitResult } | { kind: "replay"; response: ImportCommitResponse };

async function commitWithRetry(input: CommitInput, timezone: string): Promise<CommitOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { kind: "done", result: await commitOnce(input) };
    } catch (e) {
      if (attempt < MAX_COMMIT_ATTEMPTS && isTrackingCollision(e)) continue;
      if (uniqueTarget(e) !== null) {
        // A concurrent request with the same idempotency key won the race.
        if (input.idempotencyKey) {
          const replay = await replayCommit(input.user.organizationId, input.idempotencyKey, input.fileHash);
          if (replay) return { kind: "replay", response: replay };
        }
        if (isFileHashConflict(e)) {
          const again = await alreadyImported(input.user.organizationId, input.fileHash);
          throw again ? alreadyImportedError(again, timezone, input.source) : new ApiError(409, `${subjectOf(input.source)} already imported`);
        }
      }
      throw e;
    }
  }
}

function parseDetail(detail: string | null | undefined): Record<string, unknown> {
  if (!detail) return {};
  try {
    const v: unknown = JSON.parse(detail);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The stored result of an already-committed idempotency key, or null.
 * Counts come from the ImportBatch; row-number lists from its audit row
 * (empty lists if that row can't be found — counts stay authoritative).
 */
async function replayCommit(organizationId: string, idempotencyKey: string, fileHash: string): Promise<ImportCommitResponse | null> {
  const batch = await db.importBatch.findUnique({
    where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    select: { id: true, fileHash: true, createdAt: true, importedCount: true, skippedCount: true, failedCount: true },
  });
  if (!batch) return null;
  if (batch.fileHash !== fileHash) {
    throw new ApiError(409, "This idempotency key was already used for different rows — start the import again");
  }
  const log = await db.auditLog.findFirst({
    // createdAt bound keeps the lookup on the (organizationId, createdAt) index.
    where: {
      organizationId,
      action: "DELIVERIES_IMPORTED",
      entityType: "ImportBatch",
      entityId: batch.id,
      createdAt: { gte: new Date(batch.createdAt.getTime() - 60_000) },
    },
    select: { detail: true },
    orderBy: { createdAt: "asc" },
  });
  const detail = parseDetail(log?.detail);
  const list = (v: unknown) => (typeof v === "string" ? expandRowNumbers(v) : []);
  return {
    batchId: batch.id,
    imported: batch.importedCount,
    skipped: batch.skippedCount,
    failed: batch.failedCount,
    importedRows: list(detail.importedRows),
    skippedRows: list(detail.skippedRows),
    failedRows: list(detail.failedRows),
    emailsQueued: typeof detail.emailsQueued === "number" ? detail.emailsQueued : 0,
    replayed: true,
  };
}

/** Customer tracking emails, best-effort, after the response is sent. */
function queueTrackingEmails(organizationId: string, created: CreatedDelivery[]): number {
  const toEmail = created.filter((d) => d.recipientEmail);
  if (toEmail.length) {
    after(async () => {
      const queue = [...toEmail];
      const worker = async () => {
        for (let d = queue.shift(); d; d = queue.shift()) {
          const delivery = d;
          await bestEffort("customer tracking email (import)", () =>
            sendCustomerTrackingEmail({
              organizationId,
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
  return toEmail.length;
}

// ── Mapped rows ──────────────────────────────────────────────

async function handleMapped(user: SessionUser, body: MappedBody): Promise<Response> {
  const { mode, source, fileName, rows } = body;
  const organizationId = user.organizationId;

  if (mode === "preview") {
    const { timezone, now, opts } = await importOptions(organizationId);
    const plan = planOrBadRequest(() => planFromMappedRows(rows, { ...opts, maxRows: MAX_IMPORT_ROWS }));
    const contentHash = sha256(canonicalRowsJson(rows));
    const checked = detectDuplicates(plan.rows, await loadExisting(db, organizationId, plan.rows, now), opts);
    const [prev, remaining] = await Promise.all([alreadyImported(organizationId, contentHash), monthlyDeliveriesRemaining(organizationId, timezone)]);
    const response: ImportPreviewResponse & { fileWarnings: string[] } = {
      contentHash,
      alreadyImported: prev,
      timezone,
      monthlyDeliveriesRemaining: remaining,
      totals: importTotals(checked),
      rows: checked,
      fileWarnings: plan.fileWarnings,
    };
    return ok(response);
  }

  // ── commit (one chunk) ──────────────────────────────────
  const { idempotencyKey } = body;
  if (!idempotencyKey) throw new ApiError(400, "idempotencyKey is required to commit rows");
  if (rows.length > MAX_COMMIT_ROWS) {
    throw new ApiError(400, `At most ${MAX_COMMIT_ROWS} rows can be committed per request — send the import in chunks`);
  }
  const contentHash = sha256(canonicalRowsJson(rows));

  const replay = await replayCommit(organizationId, idempotencyKey, contentHash);
  if (replay) return ok(replay);

  const { timezone, now, opts } = await importOptions(organizationId);
  const plan = planOrBadRequest(() => planFromMappedRows(rows, { ...opts, maxRows: MAX_COMMIT_ROWS }));
  const prev = await alreadyImported(organizationId, contentHash);
  if (prev) throw alreadyImportedError(prev, timezone, source);

  const allow = body.allowLikelyDuplicates ?? [];
  const checked = applyLikelyDuplicateOverrides(detectDuplicates(plan.rows, await loadExisting(db, organizationId, plan.rows, now), opts), allow);
  const totals = importTotals(checked);

  const respond = (result: CommitResult, emailsQueued: number): ImportCommitResponse => ({
    batchId: result.batchId ?? "",
    imported: result.importedRows.length,
    skipped: importTotals(result.rows).duplicates,
    failed: importTotals(result.rows).invalid,
    importedRows: result.importedRows,
    skippedRows: rowNumbersWith(result.rows, "duplicate"),
    failedRows: rowNumbersWith(result.rows, "invalid"),
    emailsQueued,
    replayed: false,
  });

  // Nothing importable in this chunk: report it without writing anything.
  if (totals.valid === 0) return ok(respond({ batchId: null, created: [], rows: checked, importedRows: [] }, 0));

  const outcome = await commitWithRetry(
    {
      user,
      fileName,
      fileHash: contentHash,
      source,
      idempotencyKey,
      planRows: plan.rows,
      allowLikelyDuplicates: allow,
      expectedValid: totals.valid,
      opts,
      now,
      emptyIsConflict: false,
    },
    timezone
  );
  if (outcome.kind === "replay") return ok(outcome.response);
  const { result } = outcome;
  if (!result.batchId) return ok(respond(result, 0));
  const emailsQueued = queueTrackingEmails(organizationId, result.created);
  return ok(respond(result, emailsQueued), 201);
}

// ── Legacy raw CSV ───────────────────────────────────────────

async function handleLegacyCsv(user: SessionUser, body: z.infer<typeof legacyBodySchema>): Promise<Response> {
  const { fileName, csv, mode } = body;
  if (!/\.csv$/i.test(fileName)) throw new ApiError(400, "Only .csv files can be imported");
  const organizationId = user.organizationId;

  const { timezone, now, opts } = await importOptions(organizationId);
  const plan = planOrBadRequest(() => buildImportPlan(csv, opts));
  const fileHash = sha256(normalizeCsvText(csv));
  const rows = detectDuplicates(plan.rows, await loadExisting(db, organizationId, plan.rows, now), opts);
  const totals = importTotals(rows);

  if (mode === "preview") {
    return ok({
      fileHash,
      fileName,
      timezone,
      alreadyImported: await alreadyImported(organizationId, fileHash),
      fileWarnings: plan.fileWarnings,
      totals,
      rows,
    });
  }

  const prev = await alreadyImported(organizationId, fileHash);
  if (prev) throw alreadyImportedError(prev, timezone);
  if (totals.valid === 0) throw new ApiError(400, "There are no valid rows to import — fix the errors and upload the file again");

  const outcome = await commitWithRetry(
    {
      user,
      fileName,
      fileHash,
      source: "CSV",
      idempotencyKey: null,
      planRows: plan.rows,
      allowLikelyDuplicates: [],
      expectedValid: totals.valid,
      opts,
      now,
      emptyIsConflict: true,
    },
    timezone
  );
  if (outcome.kind === "replay") return ok(outcome.response); // unreachable without an idempotency key
  const { result } = outcome;
  const finalTotals = importTotals(result.rows);
  return ok(
    {
      batchId: result.batchId,
      imported: result.created.length,
      skipped: finalTotals.duplicates,
      failed: finalTotals.invalid,
      emailsQueued: queueTrackingEmails(organizationId, result.created),
    },
    201
  );
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();
    await assertFeature(db, user.organizationId, "csv_import");
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) throw new ApiError(413, "This import is too large — split it into smaller imports");

    const body = await readJson<unknown>(req);
    if (body !== null && typeof body === "object" && "rows" in body) {
      const parsed = mappedBodySchema.safeParse(body);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");
      return await handleMapped(user, parsed.data);
    }
    const parsed = legacyBodySchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    return await handleLegacyCsv(user, parsed.data);
  } catch (e) {
    return fail(e);
  }
}
