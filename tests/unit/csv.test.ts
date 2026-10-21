import { describe, expect, it } from "vitest";
import { CsvError, csvCell, isBlankRecord, mapHeader, normalizeCsvText, normalizeHeader, parseCsv, toCsv, utf8ByteLength } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF, LF and lone CR line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2\r")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿order_ref,name\nX,Y")[0]).toEqual(["order_ref", "name"]);
  });

  it("supports quoted fields with commas, escaped quotes and newlines", () => {
    const rows = parseCsv('name,address\n"Rahim, Uddin","House 12\nRoad 5"\n"He said ""hi""",x');
    expect(rows).toEqual([
      ["name", "address"],
      ["Rahim, Uddin", "House 12\nRoad 5"],
      ['He said "hi"', "x"],
    ]);
  });

  it("keeps CRLF inside quoted fields", () => {
    expect(parseCsv('a\r\n"x\r\ny"\r\n')).toEqual([["a"], ["x\r\ny"]]);
  });

  it("keeps empty fields, including trailing ones", () => {
    expect(parseCsv("a,,c,\n,,,\nx,y")).toEqual([
      ["a", "", "c", ""],
      ["", "", "", ""],
      ["x", "y"],
    ]);
    // A trailing all-empty record (",,,") counts as a trailing blank line.
    expect(parseCsv("a,b\n,,\n")).toEqual([["a", "b"]]);
  });

  it("treats an empty quoted field as empty", () => {
    expect(parseCsv('a,"",b')).toEqual([["a", "", "b"]]);
  });

  it("drops trailing blank lines but keeps blank lines in the middle (row numbers stay aligned)", () => {
    const rows = parseCsv("h\n1\n\n2\n\n\n  \n");
    expect(rows).toEqual([["h"], ["1"], [""], ["2"]]);
  });

  it("returns no records for empty or whitespace-only input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("﻿")).toEqual([]);
    expect(parseCsv("\n\r\n")).toEqual([]);
  });

  it("is lenient with a quote inside an unquoted value", () => {
    expect(parseCsv('5" pipe,x')).toEqual([['5" pipe', "x"]]);
  });

  it("appends text that follows a closing quote", () => {
    expect(parseCsv('"abc"def,x')).toEqual([["abcdef", "x"]]);
  });

  it("throws CsvError with the row number for an unclosed quote", () => {
    expect(() => parseCsv('a,b\n1,2\n3,"oops\n4,5')).toThrow(CsvError);
    try {
      parseCsv('a,b\n1,2\n3,"oops\n4,5');
    } catch (e) {
      expect((e as CsvError).row).toBe(3);
      expect((e as CsvError).message).toMatch(/Row 3/);
    }
  });

  it("preserves Bangla text", () => {
    expect(parseCsv("নাম,ঠিকানা\nরহিম,ঢাকা")[1]).toEqual(["রহিম", "ঢাকা"]);
  });
});

describe("helpers", () => {
  it("isBlankRecord", () => {
    expect(isBlankRecord([""])).toBe(true);
    expect(isBlankRecord(["", "  "])).toBe(true);
    expect(isBlankRecord(["", "x"])).toBe(false);
  });

  it("normalizeHeader ignores case, spaces and punctuation", () => {
    expect(normalizeHeader(" Order No. ")).toBe("order_no");
    expect(normalizeHeader("RECIPIENT-PHONE")).toBe("recipient_phone");
    expect(normalizeHeader("recipient_phone")).toBe("recipient_phone");
    expect(normalizeHeader("﻿E-mail")).toBe("e_mail");
  });

  it("normalizeCsvText removes BOM, normalizes line endings and trailing blank lines", () => {
    expect(normalizeCsvText("﻿a,b\r\n1,2\r\n\r\n")).toBe("a,b\n1,2");
    expect(normalizeCsvText("a,b\n1,2")).toBe(normalizeCsvText("a,b\r\n1,2\r\n"));
  });

  it("utf8ByteLength counts multi-byte characters", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("ঢা")).toBe(6);
  });
});

describe("mapHeader", () => {
  const aliases = { order_ref: ["order_ref", "order no", "reference"], phone: ["recipient_phone", "phone", "mobile"] } as const;

  it("maps canonical names and aliases case/space-insensitively", () => {
    const m = mapHeader(["Order No", "Mobile", "Colour"], aliases);
    expect(m.index).toEqual({ order_ref: 0, phone: 1 });
    expect(m.unknown).toEqual(["Colour"]);
  });

  it("ignores empty header cells", () => {
    expect(mapHeader(["", "phone", " "], aliases)).toEqual({ index: { phone: 1 }, unknown: [] });
  });

  it("rejects two columns mapping to the same field", () => {
    expect(() => mapHeader(["phone", "Mobile"], aliases)).toThrow(/Two columns map to "phone"/);
  });
});

describe("toCsv / csvCell", () => {
  it("quotes only when needed", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(5)).toBe("5");
  });

  it("round-trips through parseCsv", () => {
    const rows = [
      ["a", "b,c", 'q"q'],
      ["line\nbreak", "", "+8801711"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
