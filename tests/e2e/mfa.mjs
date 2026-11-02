// Two-factor helpers for the e2e scripts (super-admin sign-in is password +
// authenticator code). Same algorithm as src/lib/totp.ts: RFC 6238,
// HMAC-SHA1, 6 digits, 30-second steps.
//
// CLI — print the current code for a base32 secret (the "manual key" shown at
// enrolment, spaces allowed):
//   node tests/e2e/mfa.mjs "ABCD EFGH IJKL …"
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Current TOTP code; `stepOffset` +1 gives the next 30-second code (also accepted by the server). */
export function totpCode(secret, nowMs = Date.now(), stepOffset = 0) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30000) + stepOffset));
  const mac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/** email → { secret, backupCodes } for admins enrolled during this run. */
export const enrolled = new Map();

/**
 * Finish a staff sign-in after the password step. `loginData` is the login
 * response body ({ mfa: "enroll" | "verify" }). First sign-in enrols (QR
 * secret → code → backup codes); later ones use a backup code, so two sign-ins
 * within the same 30 s step don't trip replay protection.
 * Returns the /mfa/verify response ({ status, data }).
 */
export async function completePlatformMfa(client, email, loginData) {
  if (loginData?.mfa === "enroll") {
    const setup = await client.post("/api/platform/auth/mfa/setup");
    if (setup.status !== 200) return setup;
    const secret = setup.data.manualKey.replace(/\s/g, "");
    const v = await client.post("/api/platform/auth/mfa/verify", { code: totpCode(secret) });
    if (v.status === 200) enrolled.set(email, { secret, backupCodes: [...(v.data.backupCodes ?? [])] });
    return v;
  }
  const state = enrolled.get(email);
  if (!state) throw new Error(`No TOTP secret known for ${email} (enrolled outside this run?)`);
  const code = state.backupCodes.length > 0 ? state.backupCodes.shift() : totpCode(state.secret, Date.now(), 1);
  return client.post("/api/platform/auth/mfa/verify", { code });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const secret = process.argv.slice(2).join("");
  if (!secret) {
    console.log('Usage: node tests/e2e/mfa.mjs "<base32 secret>"');
    process.exit(1);
  }
  console.log(totpCode(secret));
}
