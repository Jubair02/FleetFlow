import { describe, expect, it } from "vitest";
import {
  base32Decode, base32Encode, consumeBackupCode, formatSecretForDisplay, generateBackupCodes, generateTotpSecret,
  hashBackupCode, hotp, looksLikeBackupCode, normalizeTotpInput, otpauthUri, totpCode, totpStep, verifyTotp,
} from "@/lib/totp";

// RFC 4226 / RFC 6238 reference secret: ASCII "12345678901234567890" (SHA-1 variant).
const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET = base32Encode(RFC_KEY);

describe("base32 (RFC 4648)", () => {
  it("matches the RFC 4648 test vectors (unpadded)", () => {
    const vectors: [string, string][] = [
      ["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(plain);
    }
  });

  it("decodes case-insensitively and ignores spaces, hyphens and padding", () => {
    expect(base32Decode("mzxw 6ytb-oi======").toString()).toBe("foobar");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });

  it("round-trips random secrets; generated secrets are 160-bit", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
});

describe("HOTP (RFC 4226 appendix D)", () => {
  it("produces the reference values for counters 0–9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => expect(hotp(RFC_KEY, counter)).toBe(code));
  });
});

describe("TOTP (RFC 6238 appendix B, SHA-1)", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it.each(vectors)("T=%i → %s (8 digits)", (seconds, code) => {
    expect(totpCode(RFC_SECRET, seconds * 1000, 8)).toBe(code);
  });

  it("6-digit codes are the last 6 digits of the reference values", () => {
    for (const [seconds, code] of vectors) expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(code.slice(-6));
  });

  it("uses 30-second steps", () => {
    expect(totpStep(59_000)).toBe(1);
    expect(totpStep(60_000)).toBe(2);
  });
});

describe("verifyTotp", () => {
  const now = 1_234_567_890_000;
  const step = totpStep(now);
  const codeAt = (s: number) => hotp(RFC_KEY, s);

  it("accepts the current step and ±1 (clock drift), returning the matched step", () => {
    expect(verifyTotp(RFC_SECRET, codeAt(step), { now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, codeAt(step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, codeAt(step + 1), { now })).toBe(step + 1);
  });

  it("refuses codes two steps away", () => {
    expect(verifyTotp(RFC_SECRET, codeAt(step - 2), { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, codeAt(step + 2), { now })).toBeNull();
  });

  it("replay protection: the last accepted step and older ones are refused", () => {
    expect(verifyTotp(RFC_SECRET, codeAt(step), { now, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, codeAt(step - 1), { now, lastStep: step - 1 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, codeAt(step), { now, lastStep: step - 1 })).toBe(step);
    expect(verifyTotp(RFC_SECRET, codeAt(step + 1), { now, lastStep: step })).toBe(step + 1);
  });

  it("tolerates spaces/hyphens but rejects malformed input and bad secrets", () => {
    const c = codeAt(step);
    expect(verifyTotp(RFC_SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, { now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, "12345", { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", { now })).toBeNull();
    expect(verifyTotp("not base32!", c, { now })).toBeNull();
    expect(normalizeTotpInput("123-456")).toBe("123456");
  });
});

describe("otpauth URI", () => {
  it("names the FleetFlow issuer and the standard parameters", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "ops@fleetflow.app");
    expect(uri.startsWith("otpauth://totp/FleetFlow:ops%40fleetflow.app?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(Object.fromEntries(params)).toEqual({ secret: "JBSWY3DPEHPK3PXP", issuer: "FleetFlow", algorithm: "SHA1", digits: "6", period: "30" });
  });

  it("formats the manual key in groups of four", () => {
    expect(formatSecretForDisplay("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});

describe("backup codes", () => {
  it("generates 10 distinct xxxxx-xxxxx codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });

  it("stores SHA-256 hashes, normalized (case, separators)", () => {
    expect(hashBackupCode("abcde-fghjk")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBackupCode("ABCDE FGHJK")).toBe(hashBackupCode("abcde-fghjk"));
  });

  it("consumes a code once: the matched hash is removed, others kept", () => {
    const codes = generateBackupCodes();
    const stored = codes.map(hashBackupCode);
    const remaining = consumeBackupCode(stored, codes[3].toUpperCase());
    expect(remaining).toHaveLength(9);
    expect(remaining).not.toContain(stored[3]);
    // the same code again → no match
    expect(consumeBackupCode(remaining!, codes[3])).toBeNull();
  });

  it("rejects unknown codes and TOTP-shaped input", () => {
    const stored = generateBackupCodes().map(hashBackupCode);
    expect(consumeBackupCode(stored, "zzzzz-zzzzz")).toBeNull();
    expect(consumeBackupCode(stored, "123456")).toBeNull();
    expect(looksLikeBackupCode("123456")).toBe(false);
    expect(looksLikeBackupCode("abcde-fghjk")).toBe(true);
  });
});
