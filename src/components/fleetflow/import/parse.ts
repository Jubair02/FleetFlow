// ─────────────────────────────────────────────────────────────
// Client-side helpers for the import dialog: turning pasted / uploaded text
// into records, column-mapping bookkeeping and the "remember my mapping"
// convenience. Parsing primitives live in @/lib/csv and @/lib/delivery-import
// (shared with the server); nothing here is trusted by the API.
// ─────────────────────────────────────────────────────────────

import { detectDelimiter, isBlankRecord, looksLikeHeader, normalizeHeader, parseDelimited } from "@/lib/csv";
import {
  COLUMN_ALIASES,
  IMPORT_COLUMNS,
  REQUIRED_COLUMNS,
  suggestMapping,
  type ImportColumn,
} from "@/lib/delivery-import";
import type { MappedRow } from "@/lib/import-contract";

/** Target of one source column; null = "Don't import". */
export type ColumnTarget = ImportColumn | null;

export interface ParsedSource {
  records: string[][];
  delimiter: string;
  /** Widest record. */
  columnCount: number;
}

export type ParseResult = { ok: true; parsed: ParsedSource } | { ok: false; message: string };

export function delimiterLabel(d: string): string {
  if (d === "\t") return "tab-separated";
  if (d === ",") return "comma-separated";
  if (d === ";") return "semicolon-separated";
  if (d === "|") return "pipe-separated";
  return `separated by “${d}”`;
}

/** Detect the delimiter and parse. Never throws. */
export function parseSourceText(text: string): ParseResult {
  try {
    const delimiter = detectDelimiter(text);
    const records = parseDelimited(text, delimiter);
    const columnCount = records.reduce((m, r) => Math.max(m, r.length), 0);
    if (records.length === 0 || columnCount === 0 || records.every(isBlankRecord)) {
      return { ok: false, message: "There are no rows to import." };
    }
    return { ok: true, parsed: { records, delimiter, columnCount } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "This text couldn't be read." };
  }
}

/** Spreadsheet-style column letter: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function defaultHasHeader(records: string[][]): boolean {
  return records.length > 0 && looksLikeHeader(records[0], COLUMN_ALIASES);
}

function isColumn(v: unknown): v is ImportColumn {
  return typeof v === "string" && (IMPORT_COLUMNS as readonly string[]).includes(v);
}

/**
 * suggestMapping() → one target per source column. Accepts either an array
 * (index = source column) or a { column: sourceIndex } record, so the dialog
 * doesn't depend on the exact shape the shared helper returns.
 */
export function suggestTargets(records: string[][], hasHeader: boolean, columnCount: number): ColumnTarget[] {
  const out: ColumnTarget[] = Array.from({ length: columnCount }, () => null);
  const s: unknown = suggestMapping(hasHeader ? (records[0] ?? null) : null, columnCount);
  if (Array.isArray(s)) {
    s.forEach((v, i) => {
      if (i < columnCount && isColumn(v)) out[i] = v;
    });
  } else if (s && typeof s === "object") {
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      if (isColumn(k) && typeof v === "number" && v >= 0 && v < columnCount) out[v] = k;
    }
  }
  return out;
}

// ── Remembered mappings (localStorage; convenience only) ────

const STORAGE_PREFIX = "fleetflow.import-mapping.v1:";

/** Identifies "the same sheet layout": normalized header cells, or the column count when there is no header. */
export function headerSignature(records: string[][], hasHeader: boolean, columnCount: number): string {
  if (!hasHeader) return `noheader:${columnCount}`;
  return "h:" + Array.from({ length: columnCount }, (_, i) => normalizeHeader(records[0]?.[i] ?? "")).join("|");
}

export function loadRememberedMapping(signature: string, columnCount: number): ColumnTarget[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + signature);
    if (!raw) return null;
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length !== columnCount) return null;
    const out = arr.map((v) => (isColumn(v) ? v : null));
    return mappingConflicts(out).size ? null : out;
  } catch {
    return null;
  }
}

export function rememberMapping(signature: string, mapping: ColumnTarget[]) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + signature, JSON.stringify(mapping));
  } catch {
    /* storage unavailable — fine, it's only a convenience */
  }
}

// ── Validation of a mapping ─────────────────────────────────

/** Target fields chosen by more than one source column. */
export function mappingConflicts(mapping: ColumnTarget[]): Set<ImportColumn> {
  const seen = new Set<ImportColumn>();
  const dup = new Set<ImportColumn>();
  for (const t of mapping) {
    if (!t) continue;
    if (seen.has(t)) dup.add(t);
    seen.add(t);
  }
  return dup;
}

export function requiredFields(pickupRequired: boolean): ImportColumn[] {
  return pickupRequired ? [...REQUIRED_COLUMNS, "pickup_address"] : [...REQUIRED_COLUMNS];
}

export function missingRequired(mapping: ColumnTarget[], pickupRequired: boolean): ImportColumn[] {
  const mapped = new Set(mapping.filter((t): t is ImportColumn => !!t));
  return requiredFields(pickupRequired).filter((c) => !mapped.has(c));
}

/** Non-blank data rows (row numbers as in the user's sheet). */
export function dataRecords(records: string[][], hasHeader: boolean): { rowNumber: number; record: string[] }[] {
  const out: { rowNumber: number; record: string[] }[] = [];
  for (let i = hasHeader ? 1 : 0; i < records.length; i++) {
    if (!isBlankRecord(records[i])) out.push({ rowNumber: i + 1, record: records[i] });
  }
  return out;
}

export function buildMappedRows(records: string[][], hasHeader: boolean, mapping: ColumnTarget[]): MappedRow[] {
  return dataRecords(records, hasHeader).map(({ rowNumber, record }) => {
    const values: MappedRow["values"] = {};
    mapping.forEach((target, i) => {
      if (target) values[target] = (record[i] ?? "").trim();
    });
    return { rowNumber, values };
  });
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
