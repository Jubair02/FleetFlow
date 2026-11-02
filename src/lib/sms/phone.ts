// ─────────────────────────────────────────────────────────────
// Bangladesh mobile numbers. Accepted (spaces/dashes allowed):
//   01XXXXXXXXX · 8801XXXXXXXXX · +8801XXXXXXXXX
// Canonical form: 8801XXXXXXXXX (what SMS gateways expect).
// Operator prefixes are 013–019; anything else is rejected.
// ─────────────────────────────────────────────────────────────

const BD_MOBILE = /^(?:\+?88)?(01[3-9]\d{8})$/;

/** Canonical 8801XXXXXXXXX, or null when the input isn't a Bangladesh mobile number. */
export function normalizeBdPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const compact = input.trim().replace(/[\s-]+/g, "");
  const m = compact.match(BD_MOBILE);
  return m ? `88${m[1]}` : null;
}

/** "8801•••••••678" — for logs, where the full number is not needed. */
export function maskPhone(phone: string): string {
  return phone.length > 7 ? `${phone.slice(0, 4)}${"•".repeat(phone.length - 7)}${phone.slice(-3)}` : "•••";
}
