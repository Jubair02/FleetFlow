import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

// ─────────────────────────────────────────────────────────────
// Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP) for the
// super-admin two-factor sign-in, plus one-time backup codes.
// HMAC-SHA1, 6 digits, 30-second steps — what every authenticator app
// (Google Authenticator, Microsoft Authenticator, 1Password, Authy…)
// expects from an otpauth:// URI. No external dependencies.
// ─────────────────────────────────────────────────────────────

export const TOTP_ISSUER = "FleetFlow";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next step too (±30 s of clock drift). */
export const TOTP_WINDOW = 1;
/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
export const TOTP_SECRET_BYTES = 20;

export const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 10; // two groups of 5, ~49 bits each
// No 0/1/i/l/o, so codes survive being read aloud or written down.
const BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

// ── base32 (RFC 4648, no padding) ────────────────────────────

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Decode base32; case-insensitive, ignores spaces, hyphens and "=" padding. Throws on other characters. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── HOTP / TOTP ──────────────────────────────────────────────

/** RFC 4226 HOTP value for a counter, zero-padded to `digits`. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/** The 30-second time step for an instant (ms since epoch). */
export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** Current code for a base32 secret (what the authenticator app shows). */
export function totpCode(secretBase32: string, nowMs: number = Date.now(), digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretBase32), totpStep(nowMs), digits);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** Constant-time string comparison (length is not secret). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** "123 456" / "123-456" → "123456"; null when it isn't a 6-digit code. */
export function normalizeTotpInput(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(digits) ? digits : null;
}

export interface TotpVerifyOptions {
  now?: number;
  /** Last step already accepted for this secret; that step and earlier ones are refused (replay protection). */
  lastStep?: number | null;
}

/**
 * Check a code against the current step ±TOTP_WINDOW. Returns the matched
 * step (store it as the new lastStep) or null. Every candidate is compared,
 * in constant time, so timing doesn't reveal which step matched.
 */
export function verifyTotp(secretBase32: string, code: string, opts: TotpVerifyOptions = {}): number | null {
  const normalized = normalizeTotpInput(code);
  if (!normalized) return null;
  let key: Buffer;
  try {
    key = base32Decode(secretBase32);
  } catch {
    return null;
  }
  const current = totpStep(opts.now ?? Date.now());
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    const ok = safeEqual(hotp(key, step), normalized);
    if (ok && matched === null && (opts.lastStep == null || step > opts.lastStep)) matched = step;
  }
  return matched;
}

/** otpauth:// URI for authenticator apps (and the QR code). */
export function otpauthUri(secretBase32: string, accountName: string, issuer = TOTP_ISSUER): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Secret grouped in fours for typing into an app by hand ("ABCD EFGH …"). */
export function formatSecretForDisplay(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, "$1 ").trim();
}

// ── Backup codes ─────────────────────────────────────────────

/** "ABCDE-fghjk" / "abcde fghjk" → "abcdefghjk". */
export function normalizeBackupCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}

/** Fresh one-time codes ("xxxxx-xxxxx"). Show them once; store only hashBackupCode() of each. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let s = "";
    for (let i = 0; i < BACKUP_CODE_LENGTH; i++) s += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    codes.add(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return [...codes];
}

/** True when the input has the shape of a backup code (not a 6-digit TOTP code). */
export function looksLikeBackupCode(input: string): boolean {
  return normalizeBackupCode(input).length === BACKUP_CODE_LENGTH;
}

/**
 * Match a typed backup code against the stored hashes. Returns the remaining
 * hashes (the used one removed) or null when nothing matched. Compares every
 * entry in constant time.
 */
export function consumeBackupCode(storedHashes: readonly string[], input: string): string[] | null {
  if (!looksLikeBackupCode(input)) return null;
  const hash = hashBackupCode(input);
  let index = -1;
  storedHashes.forEach((h, i) => {
    if (safeEqual(h, hash) && index === -1) index = i;
  });
  return index === -1 ? null : storedHashes.filter((_, i) => i !== index);
}
