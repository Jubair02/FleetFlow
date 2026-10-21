import { CSV_MAX_BYTES, CSV_MAX_ROWS, CsvError, isBlankRecord, mapHeader, normalizeHeader, parseCsv, utf8ByteLength } from "@/lib/csv";
import { PRIORITIES, type Priority } from "@/lib/constants";
import { createDeliverySchema } from "@/lib/validation";
import { DEFAULT_TIMEZONE, tzOffsetMinutes, zonedTimeToUtc } from "@/lib/timezone";

// ─────────────────────────────────────────────────────────────
// Bulk delivery import (CSV) — parsing, per-row validation and duplicate
// detection. Everything here is PURE (no database access) so it can be unit
// tested and shared with the browser; the API route does the DB lookups and
// feeds their results into detectDuplicates().
//
// Decisions (also shown to users in the import dialog):
//  • A date-only expected_delivery means 18:00 (6 PM, end of business) in
//    the organization's timezone.
//  • Dates are day-first (DD/MM/YYYY) or ISO (YYYY-MM-DD); US month-first
//    dates like 10/25/2026 are rejected rather than guessed.
//  • order_ref matching is exact (after trimming).
//  • "Likely duplicate" = same phone (digits, +880 folded to 0) + same
//    normalized delivery address + same expected day. Rows that carry two
//    different order refs are never flagged (they are explicitly separate
//    orders). Existing deliveries are only compared when the row has an
//    expected date — a shop that orders every week is not a duplicate.
// ─────────────────────────────────────────────────────────────

export const IMPORT_COLUMNS = [
  "order_ref",
  "recipient_name",
  "recipient_phone",
  "recipient_email",
  "pickup_address",
  "delivery_address",
  "instructions",
  "priority",
  "expected_delivery",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const REQUIRED_COLUMNS: readonly ImportColumn[] = ["recipient_name", "recipient_phone", "delivery_address"];

/** Header names accepted for each column (compared after normalizeHeader). */
export const COLUMN_ALIASES: Record<ImportColumn, readonly string[]> = {
  order_ref: ["order_ref", "order ref", "order_reference", "order no", "order_no", "order number", "order id", "order", "reference", "ref", "invoice", "invoice no", "invoice number"],
  recipient_name: ["recipient_name", "recipient", "name", "customer", "customer name", "receiver", "receiver name", "consignee"],
  recipient_phone: ["recipient_phone", "phone", "mobile", "phone number", "mobile number", "contact", "contact number", "customer phone", "recipient mobile"],
  recipient_email: ["recipient_email", "email", "e-mail", "customer email", "email address"],
  pickup_address: ["pickup_address", "pickup", "pickup location", "from address", "from"],
  delivery_address: ["delivery_address", "address", "delivery location", "shipping address", "drop address", "to address", "destination"],
  instructions: ["instructions", "delivery instructions", "notes", "note", "remarks", "comment", "comments"],
  priority: ["priority"],
  expected_delivery: ["expected_delivery", "expected", "expected date", "expected_at", "delivery date", "due", "due date", "deadline"],
};

export const COLUMN_LABELS: Record<ImportColumn, string> = {
  order_ref: "Order ref",
  recipient_name: "Recipient name",
  recipient_phone: "Recipient phone",
  recipient_email: "Recipient email",
  pickup_address: "Pickup address",
  delivery_address: "Delivery address",
  instructions: "Instructions",
  priority: "Priority",
  expected_delivery: "Expected delivery",
};

/** Local wall-clock time used when expected_delivery has no time. */
export const DATE_ONLY_HOUR = 18;
export const DATE_ONLY_LABEL = "18:00 (6 PM)";
/** How far back existing deliveries are compared for "likely duplicate". */
export const LIKELY_DUPLICATE_DAYS = 30;

export const TEMPLATE_FILE_NAME = "fleetflow-deliveries-template.csv";

export const TEMPLATE_ROWS: string[][] = [
  [...IMPORT_COLUMNS],
  [
    "INV-10231",
    "Rahim Uddin",
    "01711-234567",
    "rahim.uddin@example.com",
    "",
    "House 12, Road 5, Dhanmondi, Dhaka 1205",
    "Call before arrival; shop closes at 9 PM",
    "HIGH",
    "25/10/2026 15:00",
  ],
  [
    "INV-10232",
    "Nasrin Akter",
    "+8801819-765432",
    "",
    "Warehouse 3, Tejgaon I/A, Dhaka 1208",
    "Shop 41, New Market, Chattogram 4000",
    "",
    "normal",
    "2026-10-26",
  ],
];

// ── Types ────────────────────────────────────────────────────

export type ImportField = ImportColumn | "row";

export interface RowIssue {
  field: ImportField;
  message: string;
}

export type ImportRowStatus = "valid" | "invalid" | "duplicate";

/** Normalized values of a row (best effort for invalid rows). */
export interface ImportRowData {
  externalRef: string | null;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string | null;
  pickupAddress: string;
  /** True when pickup_address was blank and the org default was used. */
  pickupFromDefault: boolean;
  deliveryAddress: string;
  instructions: string | null;
  priority: string;
  /** ISO instant, or null when no (valid) date was given. */
  expectedAt: string | null;
  /** "YYYY-MM-DD HH:mm" in the org timezone, for display. */
  expectedLocal: string | null;
}

export interface DuplicateInfo {
  kind: "order_ref_in_file" | "order_ref_existing" | "likely_in_file" | "likely_existing";
  reason: string;
  /** Matching row of the same file, if any. */
  rowNumber: number | null;
  /** Matching existing delivery's tracking code, if any. */
  trackingCode: string | null;
}

export interface ImportRow {
  /** Spreadsheet row number (header = row 1). */
  rowNumber: number;
  status: ImportRowStatus;
  errors: RowIssue[];
  warnings: string[];
  data: ImportRowData;
  /** Original cell values (trimmed) — used for "Download rows to fix". */
  raw: Record<ImportColumn, string>;
  duplicateOf: DuplicateInfo | null;
}

export interface ImportPlan {
  rows: ImportRow[];
  /** File-level notes, e.g. ignored columns. */
  fileWarnings: string[];
}

export interface ImportTotals {
  rows: number;
  valid: number;
  invalid: number;
  duplicates: number;
}

/** Thrown for problems with the file as a whole (bad header, too big, …). */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

export interface ImportOptions {
  defaultPickupAddress?: string | null;
  timezone?: string;
  now?: Date;
}

// ── Cell helpers ─────────────────────────────────────────────

/**
 * Trim a cell and undo the spreadsheet "text" apostrophe our own exports add
 * before values that start with = + - @ (e.g. '+8801711… → +8801711…).
 */
export function cleanCell(value: string | undefined): string {
  const v = (value ?? "").trim();
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

/** Digits of a phone number with the Bangladesh country code folded: +880 1711… → 01711… */
export function normalizePhone(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("880") && d.length === 13) d = d.slice(2);
  return d;
}

/** Address comparison key: lower case, punctuation → space, collapsed spaces. */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

// ── Priority ─────────────────────────────────────────────────

export function parsePriority(value: string): { ok: true; priority: Priority } | { ok: false; message: string } {
  const v = value.trim().toUpperCase();
  if (!v) return { ok: true, priority: "NORMAL" };
  if ((PRIORITIES as readonly string[]).includes(v)) return { ok: true, priority: v as Priority };
  return { ok: false, message: `Priority "${value.trim()}" is not valid — use LOW, NORMAL, HIGH or URGENT` };
}

// ── Expected delivery date ───────────────────────────────────

export type ParsedExpected =
  | { ok: true; date: Date | null; local: string | null }
  | { ok: false; message: string };

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const FORMAT_HINT = "use DD/MM/YYYY, DD/MM/YYYY HH:mm, YYYY-MM-DD or YYYY-MM-DD HH:mm (24-hour)";

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parse expected_delivery as wall-clock time in `timezone`. Blank → no date.
 * Date-only values mean DATE_ONLY_HOUR:00 local. Impossible dates (31/02)
 * and out-of-range times are rejected.
 */
export function parseExpectedDelivery(value: string, timezone: string = DEFAULT_TIMEZONE): ParsedExpected {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v) return { ok: true, date: null, local: null };

  let year: number, month: number, day: number;
  let hour = DATE_ONLY_HOUR;
  let minute = 0;
  let m = ISO_RE.exec(v);
  if (m) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = DMY_RE.exec(v))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    if (/\b(am|pm)\b/i.test(v)) return { ok: false, message: `Expected delivery "${v}" uses AM/PM — use 24-hour time, e.g. 15:30` };
    return { ok: false, message: `Expected delivery "${v}" isn't a recognised date — ${FORMAT_HINT}` };
  }
  if (m[4] !== undefined) {
    hour = Number(m[4]);
    minute = Number(m[5]);
    const second = m[6] !== undefined ? Number(m[6]) : 0;
    if (hour > 23 || minute > 59 || second > 59) {
      return { ok: false, message: `Expected delivery "${v}" has an impossible time — use 00:00 to 23:59` };
    }
  }
  if (year < 2000 || year > 2100) return { ok: false, message: `Expected delivery "${v}" has an unlikely year` };
  if (month < 1 || month > 12) {
    return { ok: false, message: `Expected delivery "${v}" has no month ${month} — ${FORMAT_HINT}` };
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, message: `Expected delivery "${v}" is not a real date` };
  }
  const date = zonedTimeToUtc(year, month, day, hour, minute, timezone);
  return { ok: true, date, local: `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}` };
}

/** Calendar day (YYYY-MM-DD) of an instant in `timezone`. */
export function localDay(instant: Date, timezone: string = DEFAULT_TIMEZONE): string {
  return new Date(instant.getTime() + tzOffsetMinutes(instant, timezone) * 60_000).toISOString().slice(0, 10);
}

// ── Row validation ───────────────────────────────────────────

const SCHEMA_FIELD: Partial<Record<string, ImportColumn>> = {
  recipientName: "recipient_name",
  recipientPhone: "recipient_phone",
  recipientEmail: "recipient_email",
  pickupAddress: "pickup_address",
  deliveryAddress: "delivery_address",
  instructions: "instructions",
  externalRef: "order_ref",
  priority: "priority",
  expectedAt: "expected_delivery",
};

const REQUIRED_MESSAGES: Partial<Record<ImportColumn, string>> = {
  recipient_name: "Recipient name is required",
  recipient_phone: "Recipient phone is required",
  delivery_address: "Delivery address is required",
};

export const PICKUP_REQUIRED_MESSAGE = "Pickup address is required (or set a default pickup address in Settings)";

/**
 * Validate one data row with the same rules as manual creation
 * (createDeliverySchema) plus CSV-specific parsing. Returns status "valid"
 * or "invalid"; duplicates are decided later by detectDuplicates().
 */
export function validateRow(
  raw: Record<ImportColumn, string>,
  rowNumber: number,
  opts: ImportOptions = {}
): ImportRow {
  const tz = opts.timezone || DEFAULT_TIMEZONE;
  const now = opts.now ?? new Date();
  const errors: RowIssue[] = [];
  const warnings: string[] = [];
  const addError = (field: ImportField, message: string) => {
    if (!errors.some((e) => e.field === field)) errors.push({ field, message });
  };

  for (const col of REQUIRED_COLUMNS) {
    if (!raw[col]) addError(col, REQUIRED_MESSAGES[col]!);
  }

  const defaultPickup = opts.defaultPickupAddress?.trim() || "";
  const pickupFromDefault = !raw.pickup_address && !!defaultPickup;
  const pickupAddress = raw.pickup_address || defaultPickup;
  if (!pickupAddress) addError("pickup_address", PICKUP_REQUIRED_MESSAGE);

  const prio = parsePriority(raw.priority);
  if (!prio.ok) addError("priority", prio.message);

  const expected = parseExpectedDelivery(raw.expected_delivery, tz);
  if (!expected.ok) addError("expected_delivery", expected.message);
  else if (expected.date && expected.date.getTime() < now.getTime()) {
    warnings.push(`Expected delivery ${expected.local} is in the past — it will show as overdue`);
  }

  const candidate = {
    recipientName: raw.recipient_name,
    recipientPhone: raw.recipient_phone,
    pickupAddress,
    deliveryAddress: raw.delivery_address,
    instructions: raw.instructions,
    externalRef: raw.order_ref,
    recipientEmail: raw.recipient_email,
    priority: prio.ok ? prio.priority : "NORMAL",
    expectedAt: expected.ok && expected.date ? expected.date.toISOString() : null,
  };
  const parsed = createDeliverySchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field: ImportField = SCHEMA_FIELD[String(issue.path[0])] ?? "row";
      // Blank required cells already have a clearer message (addError keeps
      // the first per field); a too-short non-blank value says so explicitly.
      if (issue.code === "too_small" && field !== "row" && raw[field as ImportColumn] && "minimum" in issue) {
        addError(field, `${COLUMN_LABELS[field as ImportColumn]} must be at least ${String(issue.minimum)} characters`);
      } else {
        addError(field, issue.message);
      }
    }
  }

  const data: ImportRowData = {
    externalRef: raw.order_ref || null,
    recipientName: raw.recipient_name,
    recipientPhone: raw.recipient_phone,
    recipientEmail: raw.recipient_email ? raw.recipient_email.toLowerCase() : null,
    pickupAddress,
    pickupFromDefault,
    deliveryAddress: raw.delivery_address,
    instructions: raw.instructions || null,
    priority: prio.ok ? prio.priority : raw.priority,
    expectedAt: expected.ok && expected.date ? expected.date.toISOString() : null,
    expectedLocal: expected.ok ? expected.local : null,
  };

  // Report errors in column order, like reading the row left to right.
  const order = (f: ImportField) => (f === "row" ? IMPORT_COLUMNS.length : IMPORT_COLUMNS.indexOf(f));
  errors.sort((a, b) => order(a.field) - order(b.field));

  return {
    rowNumber,
    status: errors.length ? "invalid" : "valid",
    errors,
    warnings,
    data,
    raw,
    duplicateOf: null,
  };
}

// ── File → rows ──────────────────────────────────────────────

/**
 * Parse and validate a whole CSV file. Throws ImportFileError for problems
 * with the file itself (size, header, row limit, broken quoting).
 */
export function buildImportPlan(csvText: string, opts: ImportOptions = {}): ImportPlan {
  const bytes = utf8ByteLength(csvText);
  if (bytes > CSV_MAX_BYTES) {
    throw new ImportFileError(
      `This file is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is 1 MB per import. Split it into smaller files and import them one at a time.`
    );
  }
  let records: string[][];
  try {
    records = parseCsv(csvText);
  } catch (e) {
    if (e instanceof CsvError) throw new ImportFileError(`The file couldn't be read: ${e.message}`);
    throw e;
  }
  if (records.length === 0) throw new ImportFileError("The file is empty — add a header row and at least one delivery.");

  let mapping;
  try {
    mapping = mapHeader(records[0], COLUMN_ALIASES);
  } catch (e) {
    if (e instanceof CsvError) throw new ImportFileError(e.message);
    throw e;
  }
  const missing = REQUIRED_COLUMNS.filter((c) => mapping.index[c] === undefined);
  if (missing.length) {
    throw new ImportFileError(
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        "The first row must be the header — download the template to see the expected columns."
    );
  }

  const fileWarnings: string[] = [];
  // "error" is the column our own "rows to fix" download adds — ignore it quietly.
  const ignored = mapping.unknown.filter((h) => normalizeHeader(h) !== "error");
  if (ignored.length) {
    fileWarnings.push(`Ignored column${ignored.length > 1 ? "s" : ""}: ${ignored.join(", ")}`);
  }

  const dataRecords: { rowNumber: number; record: string[] }[] = [];
  for (let i = 1; i < records.length; i++) {
    if (isBlankRecord(records[i])) continue;
    dataRecords.push({ rowNumber: i + 1, record: records[i] });
  }
  if (dataRecords.length === 0) throw new ImportFileError("The file has a header but no delivery rows.");
  if (dataRecords.length > CSV_MAX_ROWS) {
    throw new ImportFileError(
      `This file has ${dataRecords.length} rows; the limit is ${CSV_MAX_ROWS} per import. Split it into smaller files and import them one at a time.`
    );
  }

  const rows = dataRecords.map(({ rowNumber, record }) => {
    const raw = {} as Record<ImportColumn, string>;
    for (const col of IMPORT_COLUMNS) {
      const idx = mapping.index[col];
      raw[col] = idx === undefined ? "" : cleanCell(record[idx]);
    }
    const row = validateRow(raw, rowNumber, opts);
    if (record.length > records[0].length && record.slice(records[0].length).some((c) => c.trim() !== "")) {
      row.warnings.push("Row has more cells than the header — extra cells were ignored (check for an unquoted comma)");
    }
    return row;
  });
  return { rows, fileWarnings };
}

// ── Duplicates ───────────────────────────────────────────────

/** Existing (non-cancelled) delivery used for duplicate checks. */
export interface ExistingDelivery {
  trackingCode: string;
  externalRef: string | null;
  recipientPhone: string;
  deliveryAddress: string;
  expectedAt: Date | string | null;
  createdAt: Date | string;
}

/** Order refs of the valid rows — what the API should look up in the DB. */
export function orderRefsToCheck(rows: ImportRow[]): string[] {
  return [...new Set(rows.map((r) => r.data.externalRef).filter((x): x is string => !!x))];
}

function fingerprint(phone: string, address: string, day: string | null): string | null {
  const p = normalizePhone(phone);
  const a = normalizeAddress(address);
  if (!p || !a) return null;
  return `${p}|${a}|${day ?? "-"}`;
}

/** Two refs that are both present and different mean explicitly separate orders. */
function distinctRefs(a: string | null, b: string | null): boolean {
  return !!a && !!b && a !== b;
}

/**
 * Mark valid rows that duplicate an earlier row of the file or an existing
 * delivery. `existing` should contain the org's non-cancelled deliveries whose
 * externalRef is in orderRefsToCheck() plus those created in the last
 * LIKELY_DUPLICATE_DAYS days. Invalid rows keep their status (their errors
 * matter more) but still "claim" their order ref, so a later copy of the
 * same order is skipped and fixing the first row imports the order once.
 */
export function detectDuplicates(rows: ImportRow[], existing: ExistingDelivery[], opts: ImportOptions = {}): ImportRow[] {
  const tz = opts.timezone || DEFAULT_TIMEZONE;
  const now = opts.now ?? new Date();
  const recentSince = now.getTime() - LIKELY_DUPLICATE_DAYS * 24 * 60 * 60 * 1000;

  const existingByRef = new Map<string, ExistingDelivery>();
  const existingByPrint = new Map<string, ExistingDelivery[]>();
  for (const d of existing) {
    if (d.externalRef && !existingByRef.has(d.externalRef)) existingByRef.set(d.externalRef, d);
    if (!d.expectedAt || new Date(d.createdAt).getTime() < recentSince) continue;
    const fp = fingerprint(d.recipientPhone, d.deliveryAddress, localDay(new Date(d.expectedAt), tz));
    if (!fp) continue;
    const list = existingByPrint.get(fp) ?? [];
    list.push(d);
    existingByPrint.set(fp, list);
  }

  const seenRefs = new Map<string, number>();
  const seenPrints = new Map<string, ImportRow[]>();

  return rows.map((row) => {
    const out: ImportRow = { ...row, duplicateOf: null };
    const ref = row.data.externalRef;
    let dup: DuplicateInfo | null = null;

    if (row.status === "valid") {
      if (ref && seenRefs.has(ref)) {
        const first = seenRefs.get(ref)!;
        dup = { kind: "order_ref_in_file", reason: `Order ref ${ref} also appears in row ${first}`, rowNumber: first, trackingCode: null };
      } else if (ref && existingByRef.has(ref)) {
        const d = existingByRef.get(ref)!;
        dup = { kind: "order_ref_existing", reason: `Order ref ${ref} was already imported as ${d.trackingCode}`, rowNumber: null, trackingCode: d.trackingCode };
      }
    }

    const day = row.data.expectedAt ? localDay(new Date(row.data.expectedAt), tz) : null;
    const fp = row.status === "valid" ? fingerprint(row.data.recipientPhone, row.data.deliveryAddress, day) : null;

    if (!dup && fp) {
      const sameInFile = (seenPrints.get(fp) ?? []).find((r) => !distinctRefs(r.data.externalRef, ref));
      if (sameInFile) {
        dup = {
          kind: "likely_in_file",
          reason: `Likely duplicate of row ${sameInFile.rowNumber} (same phone, address and expected date)`,
          rowNumber: sameInFile.rowNumber,
          trackingCode: null,
        };
      } else if (day) {
        const match = (existingByPrint.get(fp) ?? []).find((d) => !distinctRefs(d.externalRef, ref));
        if (match) {
          dup = {
            kind: "likely_existing",
            reason: `Likely duplicate of ${match.trackingCode} (same phone, address and expected date)`,
            rowNumber: null,
            trackingCode: match.trackingCode,
          };
        }
      }
    }

    if (ref && !seenRefs.has(ref)) seenRefs.set(ref, row.rowNumber);
    if (dup) {
      out.status = "duplicate";
      out.duplicateOf = dup;
    } else if (fp) {
      const list = seenPrints.get(fp) ?? [];
      list.push(row);
      seenPrints.set(fp, list);
    }
    return out;
  });
}

export function importTotals(rows: ImportRow[]): ImportTotals {
  return {
    rows: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
  };
}

/**
 * CSV rows (header first) for "Download rows to fix": the original cells of
 * every invalid row plus an "error" column, ready to correct and re-upload.
 */
export function rowsToFix(rows: ImportRow[]): string[][] {
  const out: string[][] = [[...IMPORT_COLUMNS, "error"]];
  for (const r of rows) {
    if (r.status !== "invalid") continue;
    out.push([
      ...IMPORT_COLUMNS.map((c) => r.raw[c] ?? ""),
      `Row ${r.rowNumber}: ` + r.errors.map((e) => e.message).join("; "),
    ]);
  }
  return out;
}
