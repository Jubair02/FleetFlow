// ─────────────────────────────────────────────────────────────
// Minimal RFC 4180 CSV reader/writer (no dependencies; shared by the
// browser and the server). Handles quoted fields, "" escapes, commas and
// line breaks inside quotes, CRLF / LF / CR line endings, a UTF-8 BOM
// and trailing blank lines. Any single-character delimiter is supported
// (parseDelimited) so text pasted from Excel / Google Sheets (tab separated)
// goes through the same reader. Pure functions — unit tested in tests/unit.
// ─────────────────────────────────────────────────────────────

/** Largest CSV accepted for import (bytes of UTF-8 text). */
export const CSV_MAX_BYTES = 1024 * 1024;
/** Largest number of data rows (excluding the header) accepted per file. */
export const CSV_MAX_ROWS = 1000;

export class CsvError extends Error {
  /** Spreadsheet row (1 = header) the problem was found on, when known. */
  row: number | null;
  constructor(message: string, row: number | null = null) {
    super(message);
    this.name = "CsvError";
    this.row = row;
  }
}

/** UTF-8 size of a string in bytes (works in the browser and in Node). */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Canonical form of a CSV file's text: no BOM, LF line endings, no trailing
 * blank lines/whitespace. Re-saving the same sheet with different line
 * endings therefore produces the same import fingerprint.
 */
export function normalizeCsvText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+$/, "");
}

/**
 * Parse CSV text into records (arrays of raw cell strings). Record i is
 * spreadsheet row i + 1 — a quoted cell containing line breaks still counts
 * as one row. Blank lines in the middle are kept as `[""]` so numbering stays
 * aligned with the spreadsheet; trailing blank lines are dropped.
 *
 * Lenient where spreadsheets are sloppy: a `"` inside an unquoted cell is
 * kept literally, and text after a closing quote is appended to the cell.
 * Strict where data would be lost: an unclosed quote is an error.
 */
export function parseCsv(input: string): string[][] {
  return parseDelimited(input, ",");
}

/** Delimiters detectDelimiter() can return. */
export type Delimiter = "\t" | "," | ";";

/**
 * parseCsv() generalized to any single-character delimiter (tab for text
 * copied from Excel / Google Sheets, ";" for European-locale CSV). Same
 * quoting rules: Excel and Sheets quote a copied cell that contains a line
 * break, tab or quote and double the inner quotes — exactly RFC 4180.
 */
export function parseDelimited(input: string, delimiter: string): string[][] {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new Error(`Invalid delimiter ${JSON.stringify(delimiter)}`);
  }
  const text = input.replace(/^﻿/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteStartRow = 0;
  let i = 0;
  const n = text.length;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      quoteStartRow = records.length + 1;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRecord();
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }

  if (inQuotes) {
    throw new CsvError(
      `Row ${quoteStartRow} has a quoted value that is never closed (missing ")`,
      quoteStartRow
    );
  }
  // Final record without a trailing newline.
  if (field !== "" || record.length > 0) endRecord();

  // Drop trailing blank lines.
  while (records.length > 0 && isBlankRecord(records[records.length - 1])) records.pop();
  return records;
}

/** True when every cell of a record is empty or whitespace. */
export function isBlankRecord(record: string[]): boolean {
  return record.every((c) => c.trim() === "");
}

/**
 * Guess the delimiter of pasted / uploaded text from its first non-blank
 * line (quoted sections are skipped, so "Dhaka, 1205" doesn't count):
 *  • any tab → "\t" (what Excel and Google Sheets put on the clipboard);
 *  • otherwise the more frequent of "," and ";" — a tie or neither → ",".
 */
export function detectDelimiter(text: string): Delimiter {
  const s = text.replace(/^﻿/, "");
  let tabs = 0;
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  let seenContent = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (seenContent) break; // end of the first non-blank line
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === "\t") tabs++;
    else if (ch === ",") commas++;
    else if (ch === ";") semis++;
    if (ch !== " ") seenContent = true;
  }
  if (tabs > 0) return "\t";
  return semis > commas ? ";" : ",";
}

/**
 * Drop columns on the right that are empty in EVERY record (copying a
 * selection wider than the data ends each line with extra tabs). Inner
 * empty columns are kept so column indexes stay stable.
 */
export function trimTrailingEmptyColumns(records: string[][]): string[][] {
  let width = 1;
  for (const r of records) {
    for (let c = r.length - 1; c >= width; c--) {
      if (r[c].trim() !== "") {
        width = c + 1;
        break;
      }
    }
  }
  return records.map((r) => (r.length > width ? r.slice(0, width) : r));
}

export interface ParsedTable {
  delimiter: Delimiter;
  records: string[][];
}

/**
 * Parse text pasted from a spreadsheet (or an uploaded .csv / .tsv): detect
 * the delimiter, parse with RFC 4180 quoting, drop trailing blank lines and
 * trailing all-empty columns. A "\r" before a line break (Windows
 * clipboard) is part of the line ending, not data. Throws CsvError for an
 * unclosed quote.
 */
export function parseTable(text: string, delimiter: Delimiter = detectDelimiter(text)): ParsedTable {
  return { delimiter, records: trimTrailingEmptyColumns(parseDelimited(text, delimiter)) };
}

/**
 * True when a record looks like a header row rather than data: cells name at
 * least two DIFFERENT known columns (compared like mapHeader does).
 */
export function looksLikeHeader<K extends string>(record: string[], aliases: Record<K, readonly string[]>): boolean {
  const lookup = new Map<string, K>();
  for (const key of Object.keys(aliases) as K[]) {
    for (const alias of aliases[key]) lookup.set(normalizeHeader(alias), key);
  }
  const matched = new Set<K>();
  for (const cell of record) {
    const key = lookup.get(normalizeHeader(cell));
    if (key) matched.add(key);
  }
  return matched.size >= 2;
}

/** Header cell → comparable key: "Order No." / "order_no" / " ORDER-NO " → "order_no". */
export function normalizeHeader(cell: string): string {
  return cell
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface HeaderMapping<K extends string> {
  /** Canonical column → index in the record. */
  index: Partial<Record<K, number>>;
  /** Header cells that matched no known column (ignored). */
  unknown: string[];
}

/**
 * Match a header row against canonical columns. `aliases` maps each column
 * to the normalized names that identify it (its own name included).
 * Throws when two header cells resolve to the same column.
 */
export function mapHeader<K extends string>(header: string[], aliases: Record<K, readonly string[]>): HeaderMapping<K> {
  const lookup = new Map<string, K>();
  for (const key of Object.keys(aliases) as K[]) {
    for (const alias of aliases[key]) lookup.set(normalizeHeader(alias), key);
  }
  const index: Partial<Record<K, number>> = {};
  const unknown: string[] = [];
  header.forEach((cell, i) => {
    const norm = normalizeHeader(cell);
    if (!norm) return;
    const key = lookup.get(norm);
    if (!key) {
      unknown.push(cell.trim());
      return;
    }
    if (index[key] !== undefined) {
      throw new CsvError(`Two columns map to "${key}" ("${header[index[key]!].trim()}" and "${cell.trim()}") — keep only one`, 1);
    }
    index[key] = i;
  });
  return { index, unknown };
}

/** Quote a cell per RFC 4180 when it contains a comma, quote or line break. */
export function csvCell(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows as CSV with CRLF line endings (no BOM, no formula escaping). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
