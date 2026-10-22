import { describe, expect, it } from "vitest";
import {
  applyLikelyDuplicateOverrides,
  canonicalRowsJson,
  compressRowNumbers,
  detectDuplicates,
  expandRowNumbers,
  IMPORT_COLUMNS,
  ImportFileError,
  importTotals,
  LIKELY_DUPLICATE_OVERRIDE_WARNING,
  planFromMappedRows,
  suggestMapping,
  unmappedColumnMessage,
  validateRow,
  type ExistingDelivery,
  type ImportColumn,
  type ImportOptions,
} from "@/lib/delivery-import";
import { MAX_IMPORT_ROWS, type MappedRow } from "@/lib/import-contract";

const NOW = new Date("2026-10-21T06:00:00Z");
const OPTS: ImportOptions = { timezone: "Asia/Dhaka", now: NOW, defaultPickupAddress: "Warehouse 3, Tejgaon I/A, Dhaka" };

const values = (over: Partial<Record<ImportColumn, string>> = {}): Partial<Record<ImportColumn, string>> => ({
  order_ref: "INV-1",
  recipient_name: "Rahim Uddin",
  recipient_phone: "01711-234567",
  delivery_address: "House 12, Road 5, Dhanmondi, Dhaka",
  ...over,
});
const mapped = (rowNumber: number, over: Partial<Record<ImportColumn, string>> = {}): MappedRow => ({ rowNumber, values: values(over) });

describe("suggestMapping", () => {
  it("maps header cells through the aliases, unknown → null", () => {
    expect(suggestMapping(["Customer Name", "Mobile", "Colour", "Shipping Address", "Invoice No"], 5)).toEqual([
      "recipient_name",
      "recipient_phone",
      null,
      "delivery_address",
      "order_ref",
    ]);
  });

  it("the first of two cells for the same column wins", () => {
    expect(suggestMapping(["Phone", "Mobile"], 2)).toEqual(["recipient_phone", null]);
  });

  it("covers every source column (data wider than the header)", () => {
    expect(suggestMapping(["phone"], 3)).toEqual(["recipient_phone", null, null]);
  });

  it("without a header assumes template order; extra columns → null", () => {
    expect(suggestMapping(null, 3)).toEqual(["order_ref", "recipient_name", "recipient_phone"]);
    const wide = suggestMapping(null, IMPORT_COLUMNS.length + 2);
    expect(wide.slice(0, IMPORT_COLUMNS.length)).toEqual([...IMPORT_COLUMNS]);
    expect(wide.slice(IMPORT_COLUMNS.length)).toEqual([null, null]);
    expect(suggestMapping(null, 0)).toEqual([]);
  });
});

describe("planFromMappedRows", () => {
  it("validates with the same rules as validateRow", () => {
    const plan = planFromMappedRows([mapped(2), mapped(3, { order_ref: "INV-2", recipient_phone: "12", priority: "soon" })], OPTS);
    expect(plan.rows.map((r) => r.status)).toEqual(["valid", "invalid"]);
    const direct = validateRow(
      { ...Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, ""])), ...values({ order_ref: "INV-2", recipient_phone: "12", priority: "soon" }) } as Record<ImportColumn, string>,
      3,
      OPTS
    );
    expect(plan.rows[1].errors).toEqual(direct.errors);
    expect(plan.rows[0].data.pickupFromDefault).toBe(true);
  });

  it("required fields missing on a row are errors on that row only", () => {
    const plan = planFromMappedRows([mapped(2), mapped(3, { order_ref: "INV-2", recipient_name: "  " })], OPTS);
    expect(plan.rows[0].status).toBe("valid");
    expect(plan.rows[1].errors.map((e) => e.message)).toEqual(["Recipient name is required"]);
    expect(plan.fileWarnings).toEqual([]);
  });

  it("a required column no row has (unmapped) → a clear error on every row, no crash", () => {
    const rows: MappedRow[] = [
      { rowNumber: 1, values: { recipient_name: "Rahim Uddin", delivery_address: "House 12, Dhaka" } },
      { rowNumber: 2, values: { recipient_name: "Nasrin Akter", delivery_address: "Shop 41, Chattogram", recipient_phone: "" } },
    ];
    const plan = planFromMappedRows(rows, OPTS);
    expect(plan.rows.every((r) => r.status === "invalid")).toBe(true);
    for (const r of plan.rows) {
      expect(r.errors).toEqual([{ field: "recipient_phone", message: unmappedColumnMessage("recipient_phone") }]);
    }
    expect(plan.fileWarnings[0]).toMatch(/not mapped: Recipient phone/);
  });

  it("ignores unknown keys and non-string values; trims and strips the text apostrophe", () => {
    const plan = planFromMappedRows(
      [{ rowNumber: 2, values: { ...values({ recipient_phone: "  '+8801711234567 " }), colour: "red" } as never }],
      OPTS
    );
    expect(plan.rows[0].raw.recipient_phone).toBe("+8801711234567");
    expect(Object.keys(plan.rows[0].raw).sort()).toEqual([...IMPORT_COLUMNS].sort());
  });

  it("skips blank rows and sorts by row number", () => {
    const plan = planFromMappedRows([mapped(5, { order_ref: "B" }), { rowNumber: 3, values: { recipient_name: "  " } }, mapped(2, { order_ref: "A" })], OPTS);
    expect(plan.rows.map((r) => r.rowNumber)).toEqual([2, 5]);
  });

  it("rejects duplicate and invalid row numbers", () => {
    expect(() => planFromMappedRows([mapped(2), mapped(2, { order_ref: "X" })], OPTS)).toThrow(/Row 2 was sent twice/);
    expect(() => planFromMappedRows([mapped(0)], OPTS)).toThrow(ImportFileError);
    expect(() => planFromMappedRows([mapped(1.5)], OPTS)).toThrow(ImportFileError);
  });

  it("rejects empty input and all-blank rows", () => {
    expect(() => planFromMappedRows([], OPTS)).toThrow(/no delivery rows/);
    expect(() => planFromMappedRows([{ rowNumber: 1, values: {} }], OPTS)).toThrow(ImportFileError);
  });

  it("enforces the row limit (default MAX_IMPORT_ROWS, configurable)", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => mapped(i + 2, { order_ref: `INV-${i}` }));
    expect(() => planFromMappedRows(many(3), { ...OPTS, maxRows: 2 })).toThrow(/3 rows; the limit is 2/);
    expect(planFromMappedRows(many(MAX_IMPORT_ROWS), OPTS).rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(() => planFromMappedRows(many(MAX_IMPORT_ROWS + 1), OPTS)).toThrow(ImportFileError);
  });
});

describe("likely-duplicate overrides", () => {
  const existing = (over: Partial<ExistingDelivery> = {}): ExistingDelivery => ({
    trackingCode: "FF-261020-ABCD",
    externalRef: null,
    recipientPhone: "+880 1711 234567",
    deliveryAddress: "House 12 Road 5 Dhanmondi Dhaka",
    expectedAt: "2026-10-25T12:00:00.000Z",
    createdAt: "2026-10-20T04:00:00.000Z",
    ...over,
  });
  const check = (rows: MappedRow[], ex: ExistingDelivery[] = []) => detectDuplicates(planFromMappedRows(rows, OPTS).rows, ex, OPTS);

  it("turns allowed likely duplicates (in file and existing) back into valid rows with a warning", () => {
    const rows = check(
      [mapped(2, { order_ref: "" }), mapped(3, { order_ref: "" }), mapped(4, { order_ref: "", expected_delivery: "25/10/2026" })],
      [existing()]
    );
    expect(rows.map((r) => r.duplicateOf?.kind ?? null)).toEqual([null, "likely_in_file", "likely_existing"]);
    const out = applyLikelyDuplicateOverrides(rows, [3, 4]);
    expect(out.map((r) => r.status)).toEqual(["valid", "valid", "valid"]);
    expect(out[1].warnings).toContain(LIKELY_DUPLICATE_OVERRIDE_WARNING);
    expect(out[2].duplicateOf?.kind).toBe("likely_existing"); // kept for display
    expect(importTotals(out).valid).toBe(3);
  });

  it("only listed rows are overridden", () => {
    const rows = check([mapped(2, { order_ref: "" }), mapped(3, { order_ref: "" })]);
    expect(applyLikelyDuplicateOverrides(rows, [99]).map((r) => r.status)).toEqual(["valid", "duplicate"]);
    expect(applyLikelyDuplicateOverrides(rows, null)).toBe(rows);
  });

  it("can NEVER unlock exact order_ref duplicates (in file or existing) or invalid rows", () => {
    const rows = check(
      [mapped(2, { order_ref: "INV-1" }), mapped(3, { order_ref: "INV-1" }), mapped(4, { order_ref: "INV-9" }), mapped(5, { order_ref: "INV-5", recipient_phone: "1" })],
      [existing({ externalRef: "INV-9", recipientPhone: "0199", deliveryAddress: "Elsewhere 1" })]
    );
    expect(rows.map((r) => r.duplicateOf?.kind ?? r.status)).toEqual(["valid", "order_ref_in_file", "order_ref_existing", "invalid"]);
    const out = applyLikelyDuplicateOverrides(rows, [2, 3, 4, 5]);
    expect(out.map((r) => r.status)).toEqual(["valid", "duplicate", "duplicate", "invalid"]);
    expect(out.flatMap((r) => r.warnings)).not.toContain(LIKELY_DUPLICATE_OVERRIDE_WARNING);
  });
});

describe("canonicalRowsJson", () => {
  it("is stable across key order, whitespace, unmapped vs empty columns, and row order in the request", () => {
    const a: MappedRow[] = [mapped(2), mapped(3, { order_ref: "INV-2" })];
    const b: MappedRow[] = [
      { rowNumber: 3, values: { delivery_address: "House 12, Road 5, Dhanmondi, Dhaka", recipient_phone: "01711-234567", recipient_name: "Rahim Uddin", order_ref: " INV-2 ", priority: "" } },
      { rowNumber: 2, values: { ...values(), instructions: "   " } },
    ];
    expect(canonicalRowsJson(a)).toBe(canonicalRowsJson(b));
  });

  it("ignores blank rows and the row-number offset (with / without a header row)", () => {
    expect(canonicalRowsJson([mapped(1), { rowNumber: 2, values: {} }, mapped(3, { order_ref: "B" })])).toBe(
      canonicalRowsJson([mapped(2), mapped(4, { order_ref: "B" })])
    );
  });

  it("changes when a value, the column a value is in, or the row order changes", () => {
    const base = canonicalRowsJson([mapped(2), mapped(3, { order_ref: "B" })]);
    expect(canonicalRowsJson([mapped(2), mapped(3, { order_ref: "C" })])).not.toBe(base);
    expect(canonicalRowsJson([mapped(2, { instructions: "INV-1", order_ref: "" }), mapped(3, { order_ref: "B" })])).not.toBe(base);
    expect(canonicalRowsJson([mapped(2, { order_ref: "B" }), mapped(3, { order_ref: "INV-1" })])).not.toBe(base);
  });
});

describe("row-number lists", () => {
  it("compress / expand round-trip", () => {
    expect(compressRowNumbers([9, 2, 3, 4, 7, 10, 3])).toBe("2-4,7,9-10");
    expect(compressRowNumbers([])).toBe("");
    expect(expandRowNumbers("2-4,7,9-10")).toEqual([2, 3, 4, 7, 9, 10]);
    const nums = Array.from({ length: 500 }, (_, i) => i * 2 + 2);
    expect(expandRowNumbers(compressRowNumbers(nums))).toEqual(nums);
  });

  it("expand skips junk and is bounded", () => {
    expect(expandRowNumbers("x,5,,7-6,a-b")).toEqual([5]);
    expect(expandRowNumbers(null)).toEqual([]);
    expect(expandRowNumbers("1-100000000", 10)).toHaveLength(10);
  });
});
