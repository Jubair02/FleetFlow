import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import {
  buildImportPlan,
  cleanCell,
  detectDuplicates,
  IMPORT_COLUMNS,
  ImportFileError,
  importTotals,
  normalizeAddress,
  normalizePhone,
  orderRefsToCheck,
  parseExpectedDelivery,
  parsePriority,
  PICKUP_REQUIRED_MESSAGE,
  rowsToFix,
  TEMPLATE_ROWS,
  validateRow,
  type ExistingDelivery,
  type ImportColumn,
  type ImportOptions,
} from "@/lib/delivery-import";

const NOW = new Date("2026-10-21T06:00:00Z"); // 12:00 in Dhaka
const OPTS: ImportOptions = { timezone: "Asia/Dhaka", now: NOW, defaultPickupAddress: "Warehouse 3, Tejgaon I/A, Dhaka" };

const HEADER = IMPORT_COLUMNS.join(",");

function raw(over: Partial<Record<ImportColumn, string>> = {}): Record<ImportColumn, string> {
  return {
    order_ref: "INV-1",
    recipient_name: "Rahim Uddin",
    recipient_phone: "01711-234567",
    recipient_email: "",
    pickup_address: "",
    delivery_address: "House 12, Road 5, Dhanmondi, Dhaka",
    instructions: "",
    priority: "",
    expected_delivery: "",
    ...over,
  };
}

function csvOf(rows: Partial<Record<ImportColumn, string>>[]): string {
  return toCsv([[...IMPORT_COLUMNS], ...rows.map((r) => IMPORT_COLUMNS.map((c) => raw(r)[c]))]);
}

const errorFields = (r: { errors: { field: string }[] }) => r.errors.map((e) => e.field);

// ── Expected delivery ────────────────────────────────────────

describe("parseExpectedDelivery", () => {
  const tz = "Asia/Dhaka";
  const iso = (v: string) => {
    const r = parseExpectedDelivery(v, tz);
    if (!r.ok) throw new Error(r.message);
    return r.date?.toISOString() ?? null;
  };

  it("blank → no date", () => {
    expect(parseExpectedDelivery("  ", tz)).toEqual({ ok: true, date: null, local: null });
  });

  it("YYYY-MM-DD → 18:00 local", () => {
    expect(iso("2026-10-25")).toBe("2026-10-25T12:00:00.000Z");
    const r = parseExpectedDelivery("2026-10-25", tz);
    expect(r.ok && r.local).toBe("2026-10-25 18:00");
  });

  it("YYYY-MM-DD HH:mm and ISO T separator", () => {
    expect(iso("2026-10-25 09:30")).toBe("2026-10-25T03:30:00.000Z");
    expect(iso("2026-10-25T09:30")).toBe("2026-10-25T03:30:00.000Z");
    expect(iso("2026-10-25 09:30:00")).toBe("2026-10-25T03:30:00.000Z");
  });

  it("DD/MM/YYYY (day first) with and without time", () => {
    expect(iso("25/10/2026")).toBe("2026-10-25T12:00:00.000Z");
    expect(iso("25/10/2026 15:00")).toBe("2026-10-25T09:00:00.000Z");
    expect(iso("5/1/2027")).toBe("2027-01-05T12:00:00.000Z");
    expect(iso("03/04/2027")).toBe("2027-04-03T12:00:00.000Z"); // 3 April, not March 4
    expect(iso("25-10-2026")).toBe("2026-10-25T12:00:00.000Z");
    expect(iso("25.10.2026 00:00")).toBe("2026-10-24T18:00:00.000Z");
  });

  it("interprets the time in the given timezone", () => {
    const r = parseExpectedDelivery("2026-07-01 12:00", "Europe/London");
    expect(r.ok && r.date?.toISOString()).toBe("2026-07-01T11:00:00.000Z");
  });

  it("rejects impossible dates and times", () => {
    for (const v of ["31/02/2026", "2026-02-30", "29/02/2027", "2026-13-01", "10/25/2026", "2026-10-25 24:00", "2026-10-25 12:60", "00/10/2026"]) {
      expect(parseExpectedDelivery(v, tz).ok, v).toBe(false);
    }
  });

  it("accepts leap days", () => {
    expect(iso("29/02/2028")).toBe("2028-02-29T12:00:00.000Z");
  });

  it("rejects unknown formats with a helpful message", () => {
    const r = parseExpectedDelivery("next friday", tz);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/DD\/MM\/YYYY/);
    const ampm = parseExpectedDelivery("25/10/2026 3:00 PM", tz);
    expect(!ampm.ok && ampm.message).toMatch(/24-hour/);
    expect(parseExpectedDelivery("25/10/26", tz).ok).toBe(false);
  });

  it("rejects absurd years", () => {
    expect(parseExpectedDelivery("1999-01-01", tz).ok).toBe(false);
  });
});

// ── Small helpers ────────────────────────────────────────────

describe("parsePriority", () => {
  it("is case-insensitive and defaults to NORMAL", () => {
    expect(parsePriority("")).toEqual({ ok: true, priority: "NORMAL" });
    expect(parsePriority(" urgent ")).toEqual({ ok: true, priority: "URGENT" });
    expect(parsePriority("High")).toEqual({ ok: true, priority: "HIGH" });
    expect(parsePriority("low")).toEqual({ ok: true, priority: "LOW" });
  });
  it("rejects other values", () => {
    expect(parsePriority("medium").ok).toBe(false);
  });
});

describe("normalizers", () => {
  it("normalizePhone keeps digits and folds +880", () => {
    expect(normalizePhone("+880 1711-234567")).toBe("01711234567");
    expect(normalizePhone("01711 234 567")).toBe("01711234567");
    expect(normalizePhone("8801711234567")).toBe("01711234567");
    expect(normalizePhone("(02) 955-1234")).toBe("029551234");
  });
  it("normalizeAddress ignores case, punctuation and spacing", () => {
    expect(normalizeAddress("House 12, Road-5,  Dhanmondi")).toBe(normalizeAddress("house 12 road 5 dhanmondi."));
    expect(normalizeAddress("বাড়ি ১২, ঢাকা")).toBe("বাড়ি ১২ ঢাকা");
  });
  it("cleanCell trims and removes the spreadsheet text apostrophe", () => {
    expect(cleanCell("  x  ")).toBe("x");
    expect(cleanCell("'+8801711")).toBe("+8801711");
    expect(cleanCell("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(cleanCell("'quoted'")).toBe("'quoted'");
    expect(cleanCell(undefined)).toBe("");
  });
});

// ── Row validation ───────────────────────────────────────────

describe("validateRow", () => {
  it("accepts a minimal valid row and normalizes values", () => {
    const r = validateRow(raw({ recipient_email: "Rahim@Example.COM", priority: "high", expected_delivery: "25/10/2026" }), 2, OPTS);
    expect(r.status).toBe("valid");
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({
      externalRef: "INV-1",
      recipientEmail: "rahim@example.com",
      priority: "HIGH",
      pickupAddress: OPTS.defaultPickupAddress,
      pickupFromDefault: true,
      expectedAt: "2026-10-25T12:00:00.000Z",
      expectedLocal: "2026-10-25 18:00",
    });
  });

  it("requires recipient name, phone and delivery address", () => {
    const r = validateRow(raw({ recipient_name: "", recipient_phone: "", delivery_address: "" }), 3, OPTS);
    expect(r.status).toBe("invalid");
    expect(errorFields(r)).toEqual(["recipient_name", "recipient_phone", "delivery_address"]);
    expect(r.errors[0].message).toBe("Recipient name is required");
  });

  it("uses the org default pickup address when blank, else requires one", () => {
    const own = validateRow(raw({ pickup_address: "Shop 2, Mirpur 10" }), 2, OPTS);
    expect(own.data.pickupAddress).toBe("Shop 2, Mirpur 10");
    expect(own.data.pickupFromDefault).toBe(false);

    const none = validateRow(raw(), 2, { ...OPTS, defaultPickupAddress: null });
    expect(none.status).toBe("invalid");
    expect(none.errors).toEqual([{ field: "pickup_address", message: PICKUP_REQUIRED_MESSAGE }]);

    const blankDefault = validateRow(raw(), 2, { ...OPTS, defaultPickupAddress: "   " });
    expect(blankDefault.errors[0]?.message).toBe(PICKUP_REQUIRED_MESSAGE);
  });

  it("applies createDeliverySchema length rules with field-specific errors", () => {
    const r = validateRow(
      raw({ recipient_name: "A", recipient_phone: "123", delivery_address: "x".repeat(301), instructions: "y".repeat(501), order_ref: "R".repeat(65) }),
      4,
      OPTS
    );
    expect(r.status).toBe("invalid");
    expect(errorFields(r).sort()).toEqual(["delivery_address", "instructions", "order_ref", "recipient_name", "recipient_phone"].sort());
    expect(r.errors.find((e) => e.field === "recipient_phone")?.message).toMatch(/at least 6/);
    expect(r.errors.find((e) => e.field === "order_ref")?.message).toMatch(/64/);
  });

  it("validates email only when present", () => {
    expect(validateRow(raw({ recipient_email: "" }), 2, OPTS).status).toBe("valid");
    const bad = validateRow(raw({ recipient_email: "not-an-email" }), 2, OPTS);
    expect(bad.errors).toEqual([{ field: "recipient_email", message: "Enter a valid customer email" }]);
  });

  it("reports bad priority and date once each", () => {
    const r = validateRow(raw({ priority: "asap", expected_delivery: "31/02/2026" }), 2, OPTS);
    expect(errorFields(r)).toEqual(["priority", "expected_delivery"]);
  });

  it("lists errors in column order", () => {
    const r = validateRow(raw({ priority: "asap", recipient_phone: "1", recipient_name: "" }), 2, OPTS);
    expect(errorFields(r)).toEqual(["recipient_name", "recipient_phone", "priority"]);
  });

  it("warns (not errors) for past expected dates", () => {
    const r = validateRow(raw({ expected_delivery: "2026-10-20" }), 2, OPTS);
    expect(r.status).toBe("valid");
    expect(r.warnings[0]).toMatch(/in the past/);
  });
});

// ── Whole file ───────────────────────────────────────────────

describe("buildImportPlan", () => {
  it("parses the template and numbers rows like a spreadsheet", () => {
    const plan = buildImportPlan("﻿" + toCsv(TEMPLATE_ROWS), OPTS);
    expect(plan.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(plan.rows.every((r) => r.status === "valid")).toBe(true);
    expect(plan.rows[1].data.pickupAddress).toBe("Warehouse 3, Tejgaon I/A, Dhaka 1208");
    expect(plan.rows[1].data.priority).toBe("NORMAL");
  });

  it("accepts header aliases, reordered columns and missing optional columns", () => {
    const csv = "Mobile,Customer Name,Order No,Address\n01711234567,Rahim Uddin,A-1,House 1 Road 2 Dhaka\n";
    const plan = buildImportPlan(csv, OPTS);
    expect(plan.rows[0].status).toBe("valid");
    expect(plan.rows[0].data).toMatchObject({ externalRef: "A-1", recipientPhone: "01711234567", recipientName: "Rahim Uddin" });
  });

  it("keeps spreadsheet row numbers when blank lines and multi-line cells are present", () => {
    const csv = `${HEADER}\nA,Rahim Uddin,01711234567,,,"House 1\nRoad 2",,,\n\nB,Karim Mia,01811234567,,,House 3 Road 4,,,\n`;
    const plan = buildImportPlan(csv, OPTS);
    expect(plan.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it("warns about ignored columns but not about our own error column", () => {
    const plan = buildImportPlan(`${HEADER},colour,error\nA,Rahim Uddin,01711234567,,,House 1 Road 2,,,,red,old\n`, OPTS);
    expect(plan.fileWarnings).toEqual(["Ignored column: colour"]);
  });

  it("warns about extra cells beyond the header", () => {
    const plan = buildImportPlan(`${HEADER}\nA,Rahim Uddin,01711234567,,,House 1, Road 2,,,,extra\n`, OPTS);
    expect(plan.rows[0].warnings.join(" ")).toMatch(/more cells than the header/);
  });

  it("rejects files with missing required columns", () => {
    expect(() => buildImportPlan("order_ref,recipient_name\nA,B\n", OPTS)).toThrow(/Missing required columns: recipient_phone, delivery_address/);
  });

  it("rejects empty files and header-only files", () => {
    expect(() => buildImportPlan("", OPTS)).toThrow(ImportFileError);
    expect(() => buildImportPlan(`${HEADER}\n\n`, OPTS)).toThrow(/no delivery rows/);
  });

  it("rejects unclosed quotes as a file error", () => {
    expect(() => buildImportPlan(`${HEADER}\nA,"Rahim,01711234567\n`, OPTS)).toThrow(/never closed/);
  });

  it("enforces the 1000-row limit with a split-the-file message", () => {
    const row = "A,Rahim Uddin,01711234567,,,House 1 Road 2,,,";
    const ok = `${HEADER}\n` + Array(1000).fill(row).join("\n");
    expect(buildImportPlan(ok, OPTS).rows).toHaveLength(1000);
    const tooMany = `${HEADER}\n` + Array(1001).fill(row).join("\n");
    expect(() => buildImportPlan(tooMany, OPTS)).toThrow(/1001 rows; the limit is 1000.*Split/);
  });

  it("enforces the 1 MB limit", () => {
    const big = `${HEADER}\n` + "x".repeat(1024 * 1024);
    expect(() => buildImportPlan(big, OPTS)).toThrow(/limit is 1 MB/);
  });

  it("rejects duplicate column mappings", () => {
    expect(() => buildImportPlan("phone,mobile,name,address\n1,2,3,4\n", OPTS)).toThrow(/Two columns map/);
  });
});

// ── Duplicates ───────────────────────────────────────────────

describe("detectDuplicates", () => {
  const plan = (rows: Partial<Record<ImportColumn, string>>[]) => buildImportPlan(csvOf(rows), OPTS).rows;
  const existing = (over: Partial<ExistingDelivery> = {}): ExistingDelivery => ({
    trackingCode: "FF-261020-ABCD",
    externalRef: null,
    recipientPhone: "+880 1711 234567",
    deliveryAddress: "House 12 Road 5 Dhanmondi Dhaka",
    expectedAt: "2026-10-25T12:00:00.000Z",
    createdAt: "2026-10-20T04:00:00.000Z",
    ...over,
  });

  it("flags the same order_ref twice in the file (first wins)", () => {
    const rows = detectDuplicates(plan([{ order_ref: "A" }, { order_ref: "B", recipient_phone: "01811111111" }, { order_ref: "A", recipient_phone: "01911111111" }]), [], OPTS);
    expect(rows.map((r) => r.status)).toEqual(["valid", "valid", "duplicate"]);
    expect(rows[2].duplicateOf).toMatchObject({ kind: "order_ref_in_file", rowNumber: 2 });
    expect(rows[2].duplicateOf?.reason).toMatch(/row 2/);
  });

  it("an invalid earlier row still claims its order_ref", () => {
    const rows = detectDuplicates(plan([{ order_ref: "A", recipient_name: "" }, { order_ref: "A", recipient_phone: "01911111111" }]), [], OPTS);
    expect(rows.map((r) => r.status)).toEqual(["invalid", "duplicate"]);
  });

  it("flags order_ref already used by an existing delivery and returns its tracking code", () => {
    const rows = detectDuplicates(plan([{ order_ref: "INV-9" }]), [existing({ externalRef: "INV-9", expectedAt: null })], OPTS);
    expect(rows[0].status).toBe("duplicate");
    expect(rows[0].duplicateOf).toMatchObject({ kind: "order_ref_existing", trackingCode: "FF-261020-ABCD" });
  });

  it("flags likely duplicates within the file (phone digits + address + same day)", () => {
    const rows = detectDuplicates(
      plan([
        { order_ref: "", recipient_phone: "01711-234567", delivery_address: "House 12, Road 5", expected_delivery: "25/10/2026" },
        { order_ref: "", recipient_phone: "+8801711234567", delivery_address: "house 12 road 5", expected_delivery: "2026-10-25 10:00" },
        { order_ref: "", recipient_phone: "+8801711234567", delivery_address: "house 12 road 5", expected_delivery: "2026-10-26" },
      ]),
      [],
      OPTS
    );
    expect(rows.map((r) => r.status)).toEqual(["valid", "duplicate", "valid"]);
    expect(rows[1].duplicateOf).toMatchObject({ kind: "likely_in_file", rowNumber: 2 });
  });

  it("does not flag rows with two different order refs as likely duplicates", () => {
    const rows = detectDuplicates(
      plan([
        { order_ref: "A", expected_delivery: "25/10/2026" },
        { order_ref: "B", expected_delivery: "25/10/2026" },
        { order_ref: "", expected_delivery: "25/10/2026" },
      ]),
      [],
      OPTS
    );
    expect(rows.map((r) => r.status)).toEqual(["valid", "valid", "duplicate"]);
  });

  it("flags likely duplicates of recent existing deliveries on the same local day", () => {
    const rows = detectDuplicates(plan([{ order_ref: "", delivery_address: "House 12, Road 5, Dhanmondi, Dhaka", expected_delivery: "25/10/2026 20:00" }]), [existing()], OPTS);
    expect(rows[0].status).toBe("duplicate");
    expect(rows[0].duplicateOf).toMatchObject({ kind: "likely_existing", trackingCode: "FF-261020-ABCD" });
  });

  it("ignores existing deliveries older than 30 days, on another day, or without a date", () => {
    const row = { order_ref: "", expected_delivery: "25/10/2026" };
    expect(detectDuplicates(plan([row]), [existing({ createdAt: "2026-09-01T00:00:00Z" })], OPTS)[0].status).toBe("valid");
    expect(detectDuplicates(plan([row]), [existing({ expectedAt: "2026-10-26T12:00:00Z" })], OPTS)[0].status).toBe("valid");
    expect(detectDuplicates(plan([row]), [existing({ expectedAt: null })], OPTS)[0].status).toBe("valid");
    // A row without an expected date is never matched against the database.
    expect(detectDuplicates(plan([{ order_ref: "" }]), [existing()], OPTS)[0].status).toBe("valid");
  });

  it("compares days in the org timezone (late-evening Dhaka is the previous UTC day)", () => {
    // 2026-10-25 23:30 Dhaka = 2026-10-25T17:30Z; existing at 2026-10-25T00:30Z = 06:30 Dhaka same day.
    const rows = detectDuplicates(plan([{ order_ref: "", expected_delivery: "25/10/2026 23:30" }]), [existing({ expectedAt: "2026-10-25T00:30:00Z" })], OPTS);
    expect(rows[0].status).toBe("duplicate");
  });

  it("does not mark invalid rows as duplicates", () => {
    const rows = detectDuplicates(plan([{ order_ref: "INV-9", priority: "asap" }]), [existing({ externalRef: "INV-9" })], OPTS);
    expect(rows[0].status).toBe("invalid");
    expect(rows[0].duplicateOf).toBeNull();
  });

  it("orderRefsToCheck returns unique refs", () => {
    expect(orderRefsToCheck(plan([{ order_ref: "A" }, { order_ref: "A" }, { order_ref: "" }, { order_ref: "B" }]))).toEqual(["A", "B"]);
  });

  it("does not mutate its input", () => {
    const input = plan([{ order_ref: "A" }, { order_ref: "A" }]);
    detectDuplicates(input, [], OPTS);
    expect(input.map((r) => r.status)).toEqual(["valid", "valid"]);
  });
});

describe("totals and rows to fix", () => {
  it("counts statuses and exports invalid rows with an error column that re-imports cleanly", () => {
    const rows = detectDuplicates(
      buildImportPlan(csvOf([{ order_ref: "A" }, { order_ref: "A" }, { order_ref: "C", recipient_phone: "'+880", priority: "soon" }]), OPTS).rows,
      [],
      OPTS
    );
    expect(importTotals(rows)).toEqual({ rows: 3, valid: 1, invalid: 1, duplicates: 1 });

    const fix = rowsToFix(rows);
    expect(fix[0]).toEqual([...IMPORT_COLUMNS, "error"]);
    expect(fix).toHaveLength(2);
    expect(fix[1][0]).toBe("C");
    expect(fix[1][2]).toBe("+880");
    expect(fix[1][9]).toMatch(/^Row 4: .*at least 6.*Priority "soon"/);

    // The downloaded file re-imports with the same header (error column ignored).
    const again = buildImportPlan(toCsv(fix), OPTS);
    expect(again.fileWarnings).toEqual([]);
    expect(again.rows[0].data.externalRef).toBe("C");
  });
});
