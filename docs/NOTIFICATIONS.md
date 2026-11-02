# Notifications

FleetFlow has three notification channels, all stored as `Notification` rows:

- **In-app** (`channel = IN_APP`): shown in the bell and on the Notifications page. Each row belongs to one user (`userId`). `status` is always null.
- **Email** (`channel = EMAIL`): the email outbox. Every email gets a row first, then it is sent through the configured provider. Admins and dispatchers see the outbox on **Notifications → Outbox**.
- **SMS** (`channel = SMS`): customer text messages (tracking link and delivery outcome) to the delivery's `recipientPhone`. They go through the same outbox as email and are listed in the same Outbox view (marked "SMS", with the phone number instead of an email address).

There is no WhatsApp or push.

## Events

"Admins" below means every active ADMIN **and DISPATCHER** of the organization.

| Event | In-app | Email (sent for real when `EMAIL_PROVIDER=resend`) | Customer SMS (plan feature `customer_sms`) |
|---|---|---|---|
| Delivery created (form or CSV import) | — | Customer, if a recipient email is set: tracking link (`trackingUrl()` under `APP_URL`) | Tracking link |
| Driver assigned | Driver | Driver: "New assignment <code>" | — |
| Driver unassigned or job removed by dispatch | Driver | — (in-app only) | — |
| Picked up / in transit (driver) | Admins | — (in-app only) | — |
| Proof of delivery uploaded without completing | Admins | — (in-app only) | — |
| Delivered (driver via status or POD upload) | Admins | Admins, and the customer if the delivery has a recipient email | "was delivered" + link |
| Delivered / failed set by an admin (including overrides) | The driver who held it | Customer only (if a recipient email is set) | Delivered / not completed + link |
| Failed (driver) | Admins | Admins, and the customer if a recipient email is set | "was not completed, we will contact you" + link |
| "Forgot password?" (any company user) | — | The user: reset link (`PASSWORD_RESET`, under `APP_URL`); the outbox row stores the text with the link redacted — see [SECURITY.md](SECURITY.md) | — |

Customer SMS fire at exactly the points where customer emails fire: the same `sendCustomerTrackingEmail` / `sendCustomerOutcomeEmail` calls send both. (The CSV import currently calls them only for rows that have a recipient email, so imported deliveries without an email get no tracking SMS yet.)

Customer emails are sent to people without an account: `userId` is null, and `organizationId`, `deliveryId` and `recipientEmail` are set. They use the company name as the sender display name ("<Company> via FleetFlow"). The failure email to customers is neutral ("the delivery attempt was unsuccessful, <Company> will contact you"). It never includes failure reasons, driver notes or other internal details.

Every email is plain text plus a simple HTML version, which is rendered from the text at send time with all content HTML-escaped.

## SMS

- **Plan gate.** Customer SMS are sent only when the organization's plan includes `customer_sms` ("Customer SMS"). It is independent of `customer_emails`; a plan without it skips SMS silently.
- **Phone numbers.** `recipientPhone` is normalized to the canonical Bangladesh form `8801XXXXXXXXX`. Accepted input: `01XXXXXXXXX`, `8801XXXXXXXXX` or `+8801XXXXXXXXX` (spaces and dashes allowed, operator prefix 013–019). Anything else is skipped: no row, no error to the user.
- **Text.** Plain English, aiming for one 160-character segment: `<Company>: your delivery <code> is scheduled. Track it: <tracking URL>` (and "… was delivered. Details: …" / "… was not completed. We will contact you. …"). The company name is shortened to 24 characters. A non-ASCII company name (e.g. Bangla) makes the message Unicode (70 characters per segment), so it may be billed as several segments. Failure texts are neutral, like the failure email.
- **Rows.** `channel = SMS`, `recipientPhone` set, `title` is a short outbox label (e.g. "Tracking link · FF-…"), `body` is exactly what is texted.
- **Providers** (`SMS_PROVIDER`):
  - `console` (default): nothing is sent. The provider logs only the masked number and the message length. Rows end `SIMULATED`.
  - `bulksmsbd`: POSTs the form fields `api_key, type=text, number, senderid, message` to `https://bulksmsbd.net/api/smsapi` (10 s timeout). `response_code: 202` means accepted; any other code marks the row `FAILED` with the code and BulkSMSBD's message. The API key is never logged and is redacted from stored errors. **The request/response format was written from BulkSMSBD's documentation without a live test — verify it with a test send (see the end of this page) before relying on it.** It is isolated in `src/lib/sms/bulksmsbd.ts`.
  - `bulksmsbd` without `BULKSMSBD_API_KEY` or `BULKSMSBD_SENDER_ID` falls back to console with one warning, shown in the outbox.
- **Dedupe keys:** `sms:tracking:<deliveryId>:<phone>`, `sms:delivered:<deliveryId>:<phone>`, `sms:failed:<failedEventId>:<phone>`.

## Configuration

Set these in `.env` (see `.env.example`). Never commit `.env`, and never paste keys into chat, issues or commits.

| Variable | Meaning |
|---|---|
| `EMAIL_PROVIDER` | `console` (default) or `resend` |
| `RESEND_API_KEY` | Resend API key (required for `resend`) |
| `EMAIL_FROM` | Sender, e.g. `FleetFlow <notifications@your-domain.com>`. The address must be on a domain **verified in Resend**, or Resend rejects the send (the row shows FAILED with Resend's message). FleetFlow replaces the display name with "<Company> via FleetFlow". |
| `APP_URL` | Public base URL used for tracking links (default `http://localhost:3000`) |
| `SMS_PROVIDER` | `console` (default) or `bulksmsbd` |
| `BULKSMSBD_API_KEY` | BulkSMSBD API key (required for `bulksmsbd`) |
| `BULKSMSBD_SENDER_ID` | BulkSMSBD approved sender id (required for `bulksmsbd`) |
| `CRON_SECRET` | Shared secret for `/api/cron/*`. Unset = cron routes answer 503 (automatic retries off) |

- **console mode** (the default, for development): nothing leaves the server. The provider logs only the recipient and subject to the server console. Rows end as `SIMULATED`, and the outbox shows a banner saying emails are simulated.
- **resend mode**: emails are POSTed to `https://api.resend.com/emails` with `Authorization: Bearer <key>` and an `Idempotency-Key` header. Rows end as `SENT` with the Resend message id in `providerMessageId`.
- If `EMAIL_PROVIDER=resend` but `RESEND_API_KEY` or `EMAIL_FROM` is missing or invalid, FleetFlow falls back to console mode. It logs a single warning, and the outbox banner shows that warning (from `emailStatus.warning`).
- The env is read once per server process, so restart after changing it.
- The outbox API reports `emailStatus = { provider, configured, from, warning }`, where `from` is the sender **domain only**. The key is never returned or logged.

## Delivery states (email and SMS rows)

```
PENDING ──claim──▶ SENDING ──ok──▶ SENT        (resend)
                           ──ok──▶ SIMULATED   (console)
                           ──error──▶ FAILED (lastError) ──retry──▶ SENDING …
```

- **Queue then send.** The row is created as `PENDING` after the delivery change has committed, and is dispatched immediately. Notification work runs inside `bestEffort`: a notification problem never fails or rolls back the delivery operation.
- **Claim.** A conditional `updateMany` moves the row to `SENDING`, increments `attempts` and sets `lastAttemptAt`, so two requests can't send the same row. While a row is `SENDING`, `sentAt` holds the claim time. It is overwritten on success and cleared on failure.
- **Failures.** On failure, `lastError` gets a short message (at most 300 characters, with credentials stripped).
- **Dedupe.** Each email carries an event-specific `dedupeKey` (unique in the DB):
  - `assigned:<assignmentId>:<driverId>`
  - `delivered:<deliveryId>:<adminId>`
  - `failed:<failedEventId>:<adminId>`
  - `customer-tracking:<deliveryId>:<email>`
  - `customer-delivered:<deliveryId>:<email>`
  - `customer-failed:<failedEventId>:<email>`

  A second insert with the same key is skipped (Prisma `P2002`), which protects against double submits and repeated events. A delivery that fails twice produces two failure emails, because each failure is a separate event.
- **Provider idempotency.** The provider idempotency key is fixed per row (`fleetflow-notification-<rowId>`). If a send is repeated after a crash mid-request, Resend drops the duplicate (within its 24-hour idempotency window).

## Retries

`POST /api/notifications/retry` (admins and dispatchers) accepts `{ "ids": ["..."] }` or `{ "allFailed": true }`. The outbox UI has a **Retry** button per failed row and a **Retry all failed** button.

- **Scope.** Only rows in the caller's organization are retried (email and SMS).
- **Which rows.** `FAILED` rows, `PENDING` rows older than 2 minutes (never dispatched, e.g. the process died), and `SENDING` rows whose claim is older than 5 minutes (stuck).
- **Limits.** Each row can be attempted at most 3 times; after that it stays `FAILED`. Each request handles up to 50 rows, one at a time.
- **Response.** The response is `{ attempted, sent, simulated, failed, skipped }`.
### Automatic retries (cron)

`GET /api/cron/outbox` retries due rows for **every** organization and returns counts only (`{ success, attempted, sent, simulated, failed, skipped }`).

- **Auth.** `Authorization: Bearer <CRON_SECRET>`, compared in constant time. Wrong or missing header → 401; `CRON_SECRET` unset → 503. Vercel Cron sends this header automatically when `CRON_SECRET` is set in the project's environment.
- **Which rows.** `FAILED` rows with `attempts < 3` whose `lastAttemptAt` is older than the backoff `5 min × 2^(attempts-1)` (capped at 6 h), plus stale `PENDING` (> 2 min) and stuck `SENDING` (> 5 min) rows. Rows created more than 3 days ago are left alone (no week-old tracking texts).
- **Limits.** Up to 50 rows per run, 4 at a time. The claim is still atomic, so a cron run overlapping a manual retry can't double-send.
- **Schedule.** `vercel.json` runs it once a day (`0 3 * * *`, UTC) because Vercel Hobby only allows daily crons. On a Pro plan, change it to `*/15 * * * *` so failed messages are retried within minutes. Outside Vercel, call the URL from any scheduler with the Bearer header.

## Verifying real sending later

1. In Resend, verify your sending domain (DNS records), then create an API key with "sending access".
2. On the server only, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=<key>` and `EMAIL_FROM="FleetFlow <notifications@<verified-domain>>"`, then restart.
3. Open **Notifications → Outbox**. The banner should read "Sending real email via Resend", followed by your domain. If it still says simulated, read the warning it shows.
4. Create a delivery with your own address as the recipient email. The row should turn **Sent**, the message should arrive, and it should appear in the Resend dashboard under the same message id.
5. If the row shows **Failed**, read the error, fix the configuration (for example an unverified domain), restart, and click **Retry**.

Keep keys out of chat, screenshots, commits and logs. Rotate a key immediately if it was exposed.

## Verifying real SMS later

1. In BulkSMSBD, get an API key and an approved sender id; whitelist the server's IP if your account requires it.
2. On the server only, set `SMS_PROVIDER=bulksmsbd`, `BULKSMSBD_API_KEY` and `BULKSMSBD_SENDER_ID`, then restart.
3. Give the organization a plan with **Customer SMS**, then create a delivery with your own mobile number as the recipient phone.
4. The SMS row in **Notifications → Outbox** should turn **Sent** with BulkSMSBD's message id in `providerMessageId`. If it shows **Failed**, the error carries BulkSMSBD's response code (e.g. 1002 sender id, 1007 balance, 1032 IP not whitelisted). If the request format itself is rejected, adjust `src/lib/sms/bulksmsbd.ts` only.
