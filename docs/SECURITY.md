# Account security

How FleetFlow signs people in, keeps them signed in, and recovers accounts.
Code: `src/lib/auth.ts` (company), `src/lib/platform-auth.ts` + `src/lib/platform-mfa.ts` (super admins),
`src/lib/password-reset.ts`, `src/lib/totp.ts`, `src/lib/session-policy.ts` (every duration below).

## Sessions

Both kinds of session are DB rows keyed by the SHA-256 of an httpOnly cookie token, so a database leak can't be replayed and any session can be revoked.

| Account | Cookie | Absolute lifetime | Idle timeout |
|---|---|---|---|
| Company admin / dispatcher | `ff_session` | 7 days | **24 hours** without a request |
| Driver | `ff_session` | 7 days | none (phones sit idle between shifts) |
| Super admin (platform console) | `ff_platform_session` | 12 hours (from the 2FA step) | **30 minutes** without a request |
| Super admin, password accepted, code not yet entered | `ff_platform_session` (`mfaPending`) | **10 minutes** | — |

- `lastSeenAt` is written at most once a minute per session (`SESSION_TOUCH_INTERVAL_MS`), so activity tracking doesn't cost a DB write per request.
- An idle session is deleted on its next request, which gets a `401` saying the session ended after inactivity. The company app signs out with a toast; the platform console shows a toast and returns to sign-in.
- Sessions created before idle tracking existed (`lastSeenAt` null) are stamped on their next request rather than expired, so deploying this doesn't sign everyone out.

## Forgot password (company users)

"Forgot password?" on the sign-in screen → `POST /api/auth/forgot-password { email }`.

- The answer is always the same `200` (`If an account exists for that email, …`) — for unknown emails, deactivated accounts and suspended companies too. The lookup is the only work done before responding; the link is created and emailed after the response (`after()`), so timing doesn't reveal accounts either.
- Rate limits (every request counts, 15-minute window): 20 per client IP (`forgot-ip:`; over the limit → `429`) and 3 per mailbox (`forgot-email:`; over the limit → same `200`, nothing sent).
- The link is `<APP_URL>/reset-password?token=<43-char base64url>`: 32 random bytes, only the SHA-256 is stored (`PasswordResetToken`), valid **1 hour**, **single use**. A new request voids the user's earlier unused links.
- The email goes through the normal outbox (type `PASSWORD_RESET`), but the outbox row stores a redacted body — company staff can read their organization's outbox, so the real link exists only in the delivered email. An outbox retry sends the redacted text (the user simply requests a new link).
- `/reset-password` is `noindex`, sent with `Referrer-Policy: no-referrer` (the rest of the app uses `strict-origin`: origin only, never paths or tokens — map tiles need a referrer), and removes the token from the address bar on load. It checks the link up front and shows "this link can't be used" for used/expired ones.
- `POST /api/auth/reset-password { token, newPassword }` (same rules as change-password: 8–200 characters) claims the token atomically, sets the password, clears `mustChangePassword`, deletes the user's other reset links, **signs out every session**, writes an AuditLog `PASSWORD_RESET` row, and lifts any sign-in lockout on that email. The user then signs in normally (no auto-login).
- **Requirements:** `APP_URL` (the link's host) and a real email provider (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`). With the console provider nothing is delivered. Drivers without email access keep using the admin reset (Team / Drivers → Reset password).
- Super admins can't use this flow; an operator runs `node scripts/create-super-admin.mjs --email <email> --reset-password`.

## Super-admin two-factor sign-in (mandatory)

Authenticator app (TOTP: RFC 6238, HMAC-SHA1, 6 digits, 30-second steps, ±1 step accepted, issuer "FleetFlow").

1. Password on the shared sign-in form → a **pending** platform session (`mfaPending`, 10 minutes) and `{ kind: "platform", mfa: "enroll" | "verify" }`. A pending session is not signed in: `/platform` redirects and every `/api/platform/*` route answers `401`, except the two-factor endpoints and logout.
2. **First time (`enroll`)** — every existing super admin goes through this at their next sign-in:
   `POST /api/platform/auth/mfa/setup` → QR code (data URL), `otpauth://` URI and the key for manual entry. Scan, then
   `POST /api/platform/auth/mfa/verify { code }` → two-factor is on and **10 backup codes** are returned once (copy / download; "I've saved them" to continue). Only SHA-256 hashes of the codes are stored.
3. **Afterwards (`verify`)** — `POST /api/platform/auth/mfa/verify { code }` with the app's code or a backup code (`abcde-fghjk`, each works once).
4. On success the session token is rotated, the session gets its normal 12-hour lifetime and `PLATFORM_LOGIN` is audited. The temporary-password step (`mustChangePassword`) still follows if due.

Protections: each 30-second step is accepted once (`totpLastStep`, compare-and-set — a code can't be replayed, even concurrently); backup codes are consumed with a compare-and-set on the list; 5 wrong codes per admin (`mfa:<id>`) or 30 failures per IP (`ip:<ip>`, shared with sign-in) lock for 15 minutes.

Console → Settings → **Two-factor sign-in** shows the status and remaining backup codes, and **Regenerate backup codes** (requires a current authenticator code; old codes stop working). There is deliberately no way to turn two-factor off.

**Lost phone and backup codes:** after verifying the person out of band, an operator with `DATABASE_URL` runs

```
node scripts/reset-super-admin-2fa.mjs <email>
```

It clears the authenticator secret and backup codes, signs that admin out everywhere and writes `PLATFORM_MFA_RESET`; they enrol again at their next sign-in (password first).

Audit actions (PlatformAuditLog; never secrets or codes): `PLATFORM_LOGIN_PASSWORD_OK`, `PLATFORM_MFA_SETUP_STARTED`, `PLATFORM_MFA_ENROLLED`, `PLATFORM_MFA_FAILED`, `PLATFORM_BACKUP_CODE_USED`, `PLATFORM_BACKUP_CODES_REGENERATED`, `PLATFORM_MFA_RESET`, `PLATFORM_LOGIN`.

Known limitation: the TOTP secret is stored as plain base32 in `PlatformAdmin.totpSecret` (needed to compute codes). Anyone with database read access could generate codes — they would still need the password.

## Testing two-factor end to end

`tests/e2e/mfa.mjs` computes codes the same way the server does: `completePlatformMfa(client, email, loginData)` enrols or verifies within the e2e scripts, and `node tests/e2e/mfa.mjs "<manual key>"` prints the current code.
