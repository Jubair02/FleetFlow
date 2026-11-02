// ─────────────────────────────────────────────────────────────
// Session lifetimes & idle timeouts — the one place these durations live.
// Pure functions (no DB, no cookies) so the rules are unit-testable;
// src/lib/auth.ts (company) and src/lib/platform-auth.ts (super admins)
// apply them.
//
// A session ends at whichever comes first:
//   • its absolute expiry (fixed when it is created), or
//   • the idle limit: no request for that long (tracked in lastSeenAt).
// ─────────────────────────────────────────────────────────────

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Company sessions (admins, dispatchers, drivers): absolute lifetime. */
export const COMPANY_SESSION_TTL_MS = 7 * 24 * HOUR;

/** Company admins & dispatchers: signed out after a working day without any request. */
export const COMPANY_STAFF_IDLE_TIMEOUT_MS = 24 * HOUR;

/**
 * Drivers: no idle limit. Phones sit in pockets between shifts and a driver
 * must not be locked out mid-route; the 7-day absolute TTL still applies.
 */
export const DRIVER_IDLE_TIMEOUT_MS: number | null = null;

/** Super-admin (platform console) sessions: absolute lifetime after two-factor sign-in. */
export const PLATFORM_SESSION_TTL_MS = 12 * HOUR;

/** Super-admin sessions end after 30 minutes without a request. */
export const PLATFORM_IDLE_TIMEOUT_MS = 30 * MINUTE;

/**
 * Password accepted, authenticator code not yet entered: the half-signed-in
 * session only reaches the two-factor endpoints and dies after 10 minutes.
 */
export const PLATFORM_MFA_PENDING_TTL_MS = 10 * MINUTE;

/** lastSeenAt is written at most this often, so a busy session isn't a DB write per request. */
export const SESSION_TOUCH_INTERVAL_MS = 1 * MINUTE;

/** 401 message when a session ended because it sat unused. */
export const IDLE_SESSION_MESSAGE = "Your session ended after a period of inactivity — please sign in again.";

/** Idle limit for a company user's role (null = none). */
export function companyIdleTimeoutMs(role: string): number | null {
  return role === "DRIVER" ? DRIVER_IDLE_TIMEOUT_MS : COMPANY_STAFF_IDLE_TIMEOUT_MS;
}

/**
 * True when the session has been unused for longer than the limit.
 * A null lastSeenAt (a session created before idle tracking existed) is never
 * idle-expired: it is stamped on its next request and timed from there.
 */
export function isIdleExpired(lastSeenAt: Date | null | undefined, now: Date, timeoutMs: number | null): boolean {
  if (timeoutMs === null || !lastSeenAt) return false;
  return now.getTime() - lastSeenAt.getTime() > timeoutMs;
}

/** Whether this request should refresh lastSeenAt (throttled to once per SESSION_TOUCH_INTERVAL_MS). */
export function needsTouch(lastSeenAt: Date | null | undefined, now: Date): boolean {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}
