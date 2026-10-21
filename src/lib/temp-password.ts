import { randomInt } from "crypto";

/** No 0/O, 1/l/I — easy to read aloud or copy from a phone screen. */
export const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export const TEMP_PASSWORD_LENGTH = 10;

/** Readable random temporary password (≈ 57 bits of entropy). */
export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  return out;
}
