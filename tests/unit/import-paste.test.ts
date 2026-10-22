import { describe, expect, it } from "vitest";
import { CsvError, detectDelimiter, looksLikeHeader, parseCsv, parseDelimited, parseTable, trimTrailingEmptyColumns } from "@/lib/csv";
import { COLUMN_ALIASES, IMPORT_COLUMNS, TEMPLATE_HEADER_LINE } from "@/lib/delivery-import";

// Text pasted from Excel / Google Sheets and other delimiters (client-side parsing).

describe("detectDelimiter", () => {
  it("picks tab for Excel / Sheets clipboard text", () => {
    expect(detectDelimiter("name\tphone\taddress\r\nRahim\t01711\tDhaka, 1205\r\n")).toBe("\t");
  });

  it("tabs win even when the line also has commas and semicolons", () => {
    expect(detectDelimiter("a,b;c\td")).toBe("\t");
  });

  it("picks semicolon for European CSV", () => {
    expect(detectDelimiter("name;phone;address\nRahim;01711;Road 5, Dhaka")).toBe(";");
  });

  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('"Rahim; Karim; Co";"x"\n')).toBe(";");
    expect(detectDelimiter('"House 12, Road 5, Dhanmondi";phone\n')).toBe(";");
    expect(detectDelimiter('name,"a;b;c;d"\n')).toBe(",");
  });

  it("looks only at the first non-blank line (quoted line breaks included)", () => {
    expect(detectDelimiter("\n\n  \na,b\nx;y;z;w")).toBe(",");
    expect(detectDelimiter('"multi\nline;;;"\tb\n')).toBe("\t");
  });

  it("defaults to comma for a single column or a tie", () => {
    expect(detectDelimiter("just one column\nmore")).toBe(",");
    expect(detectDelimiter("a,b;c")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });
});

describe("parseDelimited / parseTable", () => {
  it("parseCsv is parseDelimited with a comma", () => {
    const text = 'a,b\n"x, y",2\n';
    expect(parseCsv(text)).toEqual(parseDelimited(text, ","));
  });

  it("rejects unusable delimiters", () => {
    expect(() => parseDelimited("a", '"')).toThrow();
    expect(() => parseDelimited("a", "\n")).toThrow();
    expect(() => parseDelimited("a", ",,")).toThrow();
  });

  it("parses tab-separated Excel text with CRLF and a trailing line break", () => {
    const { delimiter, records } = parseTable("order_ref\trecipient_name\r\nINV-1\tRahim Uddin\r\nINV-2\tNasrin\r\n");
    expect(delimiter).toBe("\t");
    expect(records).toEqual([
      ["order_ref", "recipient_name"],
      ["INV-1", "Rahim Uddin"],
      ["INV-2", "Nasrin"],
    ]);
  });

  it("keeps quoted multi-line cells and doubled quotes as Sheets / Excel emit them", () => {
    const pasted = 'INV-1\t"House 12\nRoad 5, Dhanmondi"\t"Say ""ring twice"""\nINV-2\tShop 41\tx\n';
    expect(parseTable(pasted).records).toEqual([
      ["INV-1", "House 12\nRoad 5, Dhanmondi", 'Say "ring twice"'],
      ["INV-2", "Shop 41", "x"],
    ]);
  });

  it("commas and semicolons inside a tab-separated cell are data", () => {
    expect(parseTable("a, b; c\td\n").records).toEqual([["a, b; c", "d"]]);
  });

  it("drops trailing empty columns (selection wider than the data) and trailing blank lines", () => {
    const pasted = "a\tb\t\t\r\n1\t2\t\t\r\n\t\t\t\r\n";
    expect(parseTable(pasted).records).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps inner empty columns so indexes stay stable", () => {
    expect(trimTrailingEmptyColumns([["a", "", "c", ""], ["", "", "", " "]])).toEqual([["a", "", "c"], ["", "", ""]]);
  });

  it("a lone trailing \\r is a line ending, not data", () => {
    expect(parseTable("a\tb\r").records).toEqual([["a", "b"]]);
  });

  it("semicolon CSV with quoted cells", () => {
    expect(parseTable('name;address\n"Rahim";"Road 5; Dhaka"\n').records).toEqual([
      ["name", "address"],
      ["Rahim", "Road 5; Dhaka"],
    ]);
  });

  it("an unclosed quote is still an error", () => {
    expect(() => parseTable('a\t"oops\nb\tc')).toThrow(CsvError);
  });
});

describe("looksLikeHeader", () => {
  it("recognises our header and common aliases", () => {
    expect(looksLikeHeader([...IMPORT_COLUMNS], COLUMN_ALIASES)).toBe(true);
    expect(looksLikeHeader(["Customer Name", "Mobile", "Shipping Address"], COLUMN_ALIASES)).toBe(true);
    expect(looksLikeHeader(TEMPLATE_HEADER_LINE.split("\t"), COLUMN_ALIASES)).toBe(true);
  });

  it("data rows are not headers", () => {
    expect(looksLikeHeader(["INV-1", "Rahim Uddin", "01711-234567", "House 12, Dhaka"], COLUMN_ALIASES)).toBe(false);
  });

  it("needs two different known columns (one match, or the same column twice, isn't enough)", () => {
    expect(looksLikeHeader(["Phone", "Rahim", "x"], COLUMN_ALIASES)).toBe(false);
    expect(looksLikeHeader(["Phone", "Mobile"], COLUMN_ALIASES)).toBe(false);
  });
});
