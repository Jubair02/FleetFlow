import { describe, expect, it } from "vitest";
import { maskPhone, normalizeBdPhone } from "@/lib/sms/phone";

describe("normalizeBdPhone", () => {
  it("accepts local, 880 and +880 forms and returns 8801XXXXXXXXX", () => {
    expect(normalizeBdPhone("01712345678")).toBe("8801712345678");
    expect(normalizeBdPhone("8801712345678")).toBe("8801712345678");
    expect(normalizeBdPhone("+8801712345678")).toBe("8801712345678");
  });

  it("allows spaces and dashes", () => {
    expect(normalizeBdPhone(" 017-1234-5678 ")).toBe("8801712345678");
    expect(normalizeBdPhone("+880 1712 345678")).toBe("8801712345678");
    expect(normalizeBdPhone("+880-1912-345-678")).toBe("8801912345678");
  });

  it("covers every operator prefix 013–019", () => {
    for (const p of ["3", "4", "5", "6", "7", "8", "9"]) {
      expect(normalizeBdPhone(`01${p}12345678`)).toBe(`8801${p}12345678`);
    }
  });

  it("rejects anything else", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "0171234567", // too short
      "017123456789", // too long
      "01212345678", // no such operator
      "01112345678",
      "1712345678", // missing leading 0
      "+1 415 555 0100",
      "+01712345678",
      "88 01712345678x",
      "(017) 12345678",
      "017.1234.5678",
      "০১৭১২৩৪৫৬৭৮", // Bangla digits are not accepted
    ]) {
      expect(normalizeBdPhone(bad)).toBeNull();
    }
  });
});

describe("maskPhone", () => {
  it("keeps only the country prefix and last 3 digits", () => {
    expect(maskPhone("8801712345678")).toBe("8801••••••678");
    expect(maskPhone("123")).toBe("•••");
  });
});
