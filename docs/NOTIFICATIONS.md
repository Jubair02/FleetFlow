# Notifications

FleetFlow has two notification channels, both stored as `Notification` rows:

- **In-app** (`channel = IN_APP`): shown in the bell and on the Notifications page. Each row belongs to one user (`userId`). `status` is always null.
- **Email** (`channel = EMAIL`): the email outbox. Every email gets a row first, then it is sent through the configured provider. Admins see the outbox on **Notifications → Email outbox**.

There is no SMS, WhatsApp or push.

## Events

| Event | In-app | Email (sent for real when `EMAIL_PROVIDER=resend`) |
|---|---|---|
| Delivery created with a recipient email (form or CSV import) | — | Customer: tracking link `${APP_URL}/?track=<token>` |
| Driver assigned | Driver | Driver: "New assignment <code>" |
| Driver unassigned or job removed by dispatch | Driver | — (in-app only) |
| Picked up / in transit (driver) | Admins | — (in-app only) |
| Proof of delivery uploaded without completing | Admins | — (in-app only) |
| Delivered (driver via status or POD upload) | Admins | Admins, and the customer if the delivery has a recipient email |
| Delivered / failed set by an admin (including overrides) | The driver who held it | Customer only (if a recipient email is set) |
| Failed (driver) | Admins | Admins, and the customer if a recipient email is set |

Customer emails are sent to people without an account: `userId` is null, and `organizationId`, `deliveryId` and `recipientEmail` are set. They use the company name as the sender display name ("<Company> via FleetFlow"). The failure email to customers is neutral ("the delivery attempt was unsuccessful, <Company> will contact you"). It never includes failure reasons, driver notes or other internal details.

Every email is plain text plus a simple HTML version, which is rendered from the text at send time with all content HTML-escaped.

## Configuration

Set these in `.env` (see `.env.example`). Never commit `.env`, and never paste keys into chat, issues or commits.

| Variable | Meaning |
|---|---|
| `EMAIL_PROVIDER` | `console` (default) or `resend` |
| `RESEND_API_KEY` | Resend API key (required for `resend`) |
| `EMAIL_FROM` | Sender, e.g. `FleetFlow <notifications@your-domain.com>`. The address must be on a domain **verified in Resend**, or Resend rejects the send (the row shows FAILED with Resend's message). FleetFlow replaces the display name with "<Company> via FleetFlow". |
| `APP_URL` | Public base URL used for tracking links (default `http://localhost:3000`) |

- **console mode** (the default, for development): nothing leaves the server. The provider logs only the recipient and subject to the server console. Rows end as `SIMULATED`, and the outbox shows a banner saying emails are simulated.
- **resend mode**: emails are POSTed to `https://api.resend.com/emails` with `Authorization: Bearer <key>` and an `Idempotency-Key` header. Rows end as `SENT` with the Resend message id in `providerMessageId`.
- If `EMAIL_PROVIDER=resend` but `RESEND_API_KEY` or `EMAIL_FROM` is missing or invalid, FleetFlow falls back to console mode. It logs a single warning, and the outbox banner shows that warning (from `emailStatus.warning`).
- The env is read once per server process, so restart after changing it.
- The outbox API reports `emailStatus = { provider, configured, from, warning }`, where `from` is the sender **domain only**. The key is never returned or logged.

## Delivery states (email rows)

```
PENDING ──claim──▶ SENDING ──ok──▶ SENT        (resend)
                           ──ok──▶ SIMULATED   (console)
                           ──error──▶ FAILED (lastError) ──retry──▶ SENDING …
```

- **Queue then send.** The row is created as `PENDING` after the delivery change has committed, and is dispatched immediately. Notification work runs inside `bestEffort`: a notification problem never fails or rolls back the delivery operation.
- **Claim.** A conditional `updateMany` moves the row to `SENDING` and increments `attempts`, so two requests can't send the same row. While a row is `SENDING`, `sentAt` holds the claim time. It is overwritten on success and cleared on failure.
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

`POST /api/notifications/retry` (admins only) accepts `{ "ids": ["..."] }` or `{ "allFailed": true }`. The outbox UI has a **Retry** button per failed row and a **Retry all failed** button.

- **Scope.** Only rows in the caller's organization are retried.
- **Which rows.** `FAILED` rows, `PENDING` rows older than 2 minutes (never dispatched, e.g. the process died), and `SENDING` rows whose claim is older than 5 minutes (stuck).
- **Limits.** Each row can be attempted at most 3 times; after that it stays `FAILED`. Each request handles up to 50 rows, one at a time.
- **Response.** The response is `{ attempted, sent, simulated, failed, skipped }`.
- **No automatic retries.** There is no background worker: retries happen only when an admin triggers them.

## Verifying real sending later

1. In Resend, verify your sending domain (DNS records), then create an API key with "sending access".
2. On the server only, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=<key>` and `EMAIL_FROM="FleetFlow <notifications@<verified-domain>>"`, then restart.
3. Open **Notifications → Email outbox**. The banner should read "Sending real email via Resend", followed by your domain. If it still says simulated, read the warning it shows.
4. Create a delivery with your own address as the recipient email. The row should turn **Sent**, the message should arrive, and it should appear in the Resend dashboard under the same message id.
5. If the row shows **Failed**, read the error, fix the configuration (for example an unverified domain), restart, and click **Retry**.

Keep keys out of chat, screenshots, commits and logs. Rotate a key immediately if it was exposed.
