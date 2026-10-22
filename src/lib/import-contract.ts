// ─────────────────────────────────────────────────────────────
// Bulk delivery import — API contract (client-safe types only).
//
// Flow: the browser parses a .csv upload OR text pasted from Excel /
// Google Sheets, the user maps columns, and the browser sends MAPPED rows.
// The server never trusts client-side checks: it re-validates every row
// with the same rules as manual delivery creation (validateRow) and the
// same duplicate detection, on every preview and every commit.
//
// POST /api/deliveries/import  (admin; plan feature csv_import)
//
//   Preview (read-only):
//     { mode: "preview", source, fileName, rows: MappedRow[] }   (≤ MAX_IMPORT_ROWS)
//     → ImportPreviewResponse
//
//   Commit (one atomic chunk of ≤ MAX_COMMIT_ROWS):
//     { mode: "commit", source, fileName, rows: MappedRow[],
//       idempotencyKey, allowLikelyDuplicates?: number[] }
//     → ImportCommitResponse (201; or 200 with replayed=true when the same
//       idempotencyKey was already committed — nothing is imported twice)
//
//   Large imports: the client previews all rows at once (so duplicates
//   inside the whole file are caught), then commits in sequential chunks,
//   each with idempotencyKey = `${sessionKey}:${chunkIndex}`. Each chunk is
//   all-or-nothing; retrying after a failure replays finished chunks and
//   continues with the rest.
//
//   Legacy body { mode, fileName, csv } (raw CSV text, server-side parsing
//   and header auto-mapping) remains supported for preview and commit.
// ─────────────────────────────────────────────────────────────

import type { ImportColumn, ImportRow, ImportTotals } from "@/lib/delivery-import";

export type ImportSource = "CSV" | "PASTE";

/** Rows per request when validating (preview). */
export const MAX_IMPORT_ROWS = 5000;
/** Rows per atomic commit chunk. */
export const MAX_COMMIT_ROWS = 500;

/** One data row after column mapping. rowNumber = row in the user's sheet (header = 1). */
export interface MappedRow {
  rowNumber: number;
  /** Unmapped columns may be omitted or "". */
  values: Partial<Record<ImportColumn, string>>;
}

export interface ImportPreviewResponse {
  /** Hash of the canonical mapped rows (same content imported before → alreadyImported). */
  contentHash: string;
  alreadyImported: { at: string; by: string } | null;
  timezone: string;
  /** Room left in this month's delivery allowance (null = unlimited). */
  monthlyDeliveriesRemaining: number | null;
  totals: ImportTotals;
  rows: ImportRow[];
}

export interface ImportCommitResponse {
  batchId: string;
  imported: number;
  /** Duplicates that were skipped. */
  skipped: number;
  /** Invalid rows that were not imported. */
  failed: number;
  /** Row numbers actually imported / skipped / failed in this chunk. */
  importedRows: number[];
  skippedRows: number[];
  failedRows: number[];
  emailsQueued: number;
  /** True when this idempotencyKey was committed before; counts are the original result. */
  replayed: boolean;
}
