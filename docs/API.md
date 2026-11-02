# FleetFlow public API & webhooks (v1)

Connect an online store (WooCommerce, Shopify, a custom site) or any back-office
system to FleetFlow: create deliveries, read their status, cancel them, and get
told the moment something changes.

- **REST API** — `https://<your FleetFlow domain>/api/v1/…`, authenticated with an API key.
- **Webhooks** — FleetFlow `POST`s signed JSON events to a URL you choose.

Both are managed by company admins in **Settings → API & webhooks** and need a plan
that includes **API & webhooks** (`api_access`). Plans are configured by FleetFlow in
the platform console (Plans → features).

Code map: `src/lib/api-keys.ts`, `src/lib/api-v1.ts`, `src/lib/public-delivery.ts`,
`src/lib/delivery-service.ts`, `src/lib/webhooks.ts`, `src/lib/webhook-url.ts`,
`src/app/api/v1/**`, `src/app/api/developers/**` (company UI APIs).

---

## 1. Authentication

Create a key in **Settings → API & webhooks → API keys**. The key looks like

```
ff_live_6xQk1oZ3…            (ff_live_ + 43 characters, 256 random bits)
```

It is shown **once**. FleetFlow stores only its SHA-256 hash; the list shows the first
12 characters (`ff_live_6xQk…`) so you can tell keys apart. Send it on every request:

```
Authorization: Bearer ff_live_6xQk1oZ3…
```

| Situation | Status | `error.code` |
|---|---|---|
| Missing / malformed / unknown / revoked key | 401 | `unauthorized` |
| Company suspended by FleetFlow | 403 | `account_suspended` |
| Plan doesn't include API & webhooks | 403 | `plan_feature_missing` |
| Rate limit exceeded | 429 | `rate_limited` |

Use one key per store/system so one can be revoked without breaking the others.
Revocation is immediate. A key's "last used" time is updated at most once a minute.
Requests are attributed as **`API: <key name>`** in the delivery history and audit log.

The API is **server-to-server only**: no CORS headers are sent, and browser
cross-site writes are refused. Never put a key in front-end JavaScript.

## 2. Rate limits

**120 requests per minute per key** (fixed one-minute window, shared by all instances).
Every authenticated response carries:

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 117
X-RateLimit-Reset: 1793270460      (unix seconds when the window resets)
```

Over the limit you get `429` with `Retry-After: <seconds>`.

## 3. Errors

Every v1 error has the same shape:

```json
{ "error": { "code": "invalid_request", "message": "Contact number is required", "field": "recipientPhone" } }
```

`field` is present on validation errors. Branch on `code`, show `message` to people.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Body/query failed validation (see `field`) |
| 400 | `invalid_json` | Body isn't valid JSON |
| 400 | `invalid_idempotency_key` | Bad `Idempotency-Key` header |
| 400 | `invalid_cursor` | Cursor not from this listing/sort mode |
| 401 | `unauthorized` | See §1 |
| 402 | `subscription_inactive` | Trial/subscription ended — account is read-only (no new deliveries) |
| 403 | `plan_limit_reached` | Monthly delivery limit of the plan reached |
| 403 | `plan_feature_missing`, `account_suspended`, `forbidden` | See §1 |
| 404 | `not_found` | No such delivery **in your company** |
| 409 | `conflict` | Not allowed in the delivery's current state |
| 409 | `idempotency_key_reused` | Same `Idempotency-Key`, different body |
| 415 | `unsupported_media_type` | Send `Content-Type: application/json` |
| 429 | `rate_limited` | See §2 |
| 500 | `internal_error` | Our fault — safe to retry with the same idempotency key |

## 4. The delivery object

```json
{
  "id": "cmh0x8k1p0001ab12cd34ef56",
  "trackingCode": "FF-261029-K7QX",
  "trackingUrl": "https://app.fleetflow.example/track/4f1c…",
  "externalRef": "WC-1001",
  "status": "IN_TRANSIT",
  "priority": "NORMAL",
  "recipientName": "Rahim Uddin",
  "recipientPhone": "01711000000",
  "recipientEmail": null,
  "pickupAddress": "Warehouse 3, Tejgaon I/A, Dhaka",
  "deliveryAddress": "House 5, Road 2, Dhanmondi, Dhaka",
  "instructions": "Call before arriving",
  "expectedAt": "2026-10-30T12:00:00.000Z",
  "completedAt": null,
  "failureReason": null,
  "failureReasonLabel": null,
  "codAmount": 1200,
  "codCollectedAmount": null,
  "codCollectedAt": null,
  "weightKg": 1.5,
  "deliveryFeeBdt": 75,
  "zone": { "name": "Inside Dhaka" },
  "driver": { "name": "Karim Hossain", "assignedAt": "2026-10-29T08:12:00.000Z" },
  "route": { "stop": 3, "eta": "2026-10-29T09:20:00.000Z" },
  "location": { "lat": 23.74651, "lng": 90.37602, "source": "API" },
  "createdAt": "2026-10-29T08:00:00.000Z",
  "updatedAt": "2026-10-29T09:30:00.000Z"
}
```

| Field | Notes |
|---|---|
| `id` | FleetFlow id. Endpoints also accept the `trackingCode` in its place. |
| `trackingUrl` | Public tracking page to send your customer; `null` while tracking is turned off for the delivery. |
| `externalRef` | Your order/invoice number (max 64). Also the duplicate guard, see §6. |
| `status` | `CREATED` (pending) · `ASSIGNED` · `PICKED_UP` · `IN_TRANSIT` · `DELIVERED` · `FAILED` · `CANCELLED` |
| `priority` | `LOW` · `NORMAL` · `HIGH` · `URGENT` |
| `failureReason` | Only while `FAILED`: `RECIPIENT_UNAVAILABLE` · `WRONG_ADDRESS` · `RECIPIENT_REFUSED` · `PACKAGE_DAMAGED` · `VEHICLE_ISSUE` · `OTHER` |
| `codAmount` | Cash to collect, whole BDT; `null` = prepaid. `codCollectedAmount`/`At` are set when the driver completes it. |
| `weightKg` | Parcel weight in kg as sent; `null` = not given. |
| `deliveryFeeBdt` | The company's delivery charge for this order, whole BDT, worked out from its delivery zones (base + extra kg + COD fee, see docs/ZONES.md) or set by the company's staff. `null` = not priced (no zone matched). |
| `zone` | `{ "name" }` of the delivery zone the charge comes from, or `null`. |
| `driver` | Display name of the assigned driver while a driver holds the job, else `null`. |
| `location` | Where the delivery goes on the map, `{ lat, lng, source }`, or `null` until known. `source`: `API` (you sent it), `PIN` (dropped by the company's staff), `GEOCODED` (looked up from the address), `DRIVER` (the driver's GPS at proof of delivery). See docs/MAPS.md. |
| `route` | Once the company has planned the driver's route: `stop` (1 = the driver's next stop in the plan) and `eta`, the planned arrival time — an **estimate** (see docs/ROUTES.md), `null` if the address isn't on the map. `null` when no route is planned or the delivery is no longer with a driver. |
| Times | ISO 8601, UTC. |

**Deliberately not exposed:** internal notes and the event history, the raw tracking
token (it's inside `trackingUrl`), driver phone/email/ids, vehicles, import batches and
cash-settlement internals. Fields may be **added** in v1; none will be renamed or removed.

## 5. Endpoints

Base URL: `https://<your FleetFlow domain>/api/v1` (shown in Settings → API & webhooks).
Examples use `$FF` for the base URL and `$KEY` for the key.

### `GET /me` — test the connection

```bash
curl -s "$FF/me" -H "Authorization: Bearer $KEY"
# 200 {"organization":{"name":"Rahman Traders"},"apiKey":{"name":"WooCommerce","prefix":"ff_live_6xQk"}}
```

### `POST /deliveries` — create a delivery

Same rules as creating one in the app: validation, monthly plan limit, read-only
accounts (402), a tracking code + link, the customer's tracking email/SMS (when the
plan includes them), history and audit entries, and the `delivery.created` webhook.

| Field | Type | |
|---|---|---|
| `recipientName` | string 2–120 | required |
| `recipientPhone` | string 6–30 | required (a valid BD mobile also gets the tracking SMS) |
| `pickupAddress` | string 5–300 | required |
| `deliveryAddress` | string 5–300 | required |
| `instructions` | string ≤ 500 | optional |
| `externalRef` | string ≤ 64 | optional, recommended — your order number |
| `recipientEmail` | email | optional — gets the tracking link by email |
| `priority` | `LOW`/`NORMAL`/`HIGH`/`URGENT` | default `NORMAL` |
| `expectedAt` | ISO date-time with offset, or `null` | optional |
| `codAmount` | integer BDT, or `null`/`0` | optional — cash on delivery |
| `weightKg` | number > 0, ≤ 1000, or `null` | optional — parcel weight; heavier parcels may cost more |
| `location` | `{ "lat": number, "lng": number }` inside Bangladesh, or `null` | optional — the drop-off point if your checkout has it (e.g. from a map pin). Stored as `source: "API"` and never replaced by an address lookup. Without it FleetFlow looks the address up. |

The delivery charge is calculated by FleetFlow from the company's zones and returned as
`deliveryFeeBdt` + `zone`; it can't be set through the API.

```bash
curl -s -X POST "$FF/deliveries" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: wc-order-1001" \
  -d '{
    "externalRef": "WC-1001",
    "recipientName": "Rahim Uddin",
    "recipientPhone": "01711000000",
    "pickupAddress": "Warehouse 3, Tejgaon I/A, Dhaka",
    "deliveryAddress": "House 5, Road 2, Dhanmondi, Dhaka",
    "codAmount": 1200,
    "expectedAt": "2026-10-30T18:00:00+06:00"
  }'
# 201 {"delivery":{…}}                                   — created
# 200 {"delivery":{…}}  + Idempotent-Replayed: true      — already existed (see §6)
```

### `GET /deliveries` — list

| Query | |
|---|---|
| `status` | comma-separated statuses, e.g. `DELIVERED,FAILED` |
| `externalRef` | exact match |
| `updatedSince` | ISO date-time — switches the sort to **oldest change first** (for syncing) |
| `limit` | 1–100, default 50 |
| `cursor` | `nextCursor` from the previous page (same filters) |

Default sort: newest created first. Response:

```json
{ "data": [ { …delivery… } ], "hasMore": true, "nextCursor": "eyJtIjoiYyIsInYiOi…" }
```

```bash
curl -s "$FF/deliveries?status=DELIVERED&limit=100" -H "Authorization: Bearer $KEY"
curl -s "$FF/deliveries?updatedSince=2026-10-29T00:00:00Z" -H "Authorization: Bearer $KEY"
curl -s "$FF/deliveries?updatedSince=2026-10-29T00:00:00Z&cursor=<nextCursor>" -H "Authorization: Bearer $KEY"
```

Incremental sync recipe: remember the `updatedAt` of the last delivery you processed
and pass it as `updatedSince` next time (deliveries updated at exactly that instant come
again — dedupe by `id` + `updatedAt`). Webhooks are the faster option.

### `GET /deliveries/{id}` — one delivery

`{id}` is the FleetFlow id **or** the tracking code (case-insensitive).

```bash
curl -s "$FF/deliveries/FF-261029-K7QX" -H "Authorization: Bearer $KEY"
# 200 {"delivery":{…}}     404 not_found (also for other companies' deliveries)
```

### `POST /deliveries/{id}/cancel` — cancel

Body `{ "reason": "…" }` (required, ≤ 500). Same rule as the app's cancel: only
**pending (`CREATED`) or `FAILED`** deliveries. Once a driver has it (`ASSIGNED`,
`PICKED_UP`, `IN_TRANSIT`) or it's `DELIVERED`, you get `409 conflict` — a dispatcher
must handle it in FleetFlow. Cancelling an already-cancelled delivery returns `200`
unchanged. The reason is recorded in the delivery history (visible on the tracking page
as "cancelled") and the audit log.

```bash
curl -s -X POST "$FF/deliveries/FF-261029-K7QX/cancel" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"reason":"Customer cancelled order WC-1001"}'
```

## 6. Idempotency — retries never duplicate

Network calls fail; retry them safely. `POST /deliveries` returns the **existing**
delivery with **`200`** (instead of `201`) and the header `Idempotent-Replayed: true` when:

1. **`Idempotency-Key` header** (1–128 of `A-Z a-z 0-9 _ . : -`) was already used by your
   company in the last **24 hours**. The body must be the same — reusing a key with a
   different body is `409 idempotency_key_reused`. Recommended: `wc-order-<order id>`.
2. **`externalRef`** matches a delivery of your company that is **not cancelled**
   (any age). To ship the same order again, cancel the old delivery first or use a new
   reference (e.g. `WC-1001-2`).

Both checks run again inside the create transaction while the company is locked, so
two simultaneous retries can't both create. A replay returns the delivery **as it is
now** (it may have moved on); it is never modified by the replayed body.

## 7. Webhooks

Add endpoints in **Settings → API & webhooks → Webhook endpoints** (up to 10): a URL,
an optional description and the events to receive. Each endpoint has its own
**signing secret** (`whsec_…`; reveal or rotate it from the endpoint's menu).
"Send test event" sends a `ping` immediately and shows the result; every endpoint
shows its recent deliveries with **Retry now**.

### Events

| Event | When |
|---|---|
| `delivery.created` | Created in the app, by CSV import, or through the API |
| `delivery.assigned` | A driver + vehicle was assigned (also on re-assignment) |
| `delivery.status_changed` | **Every** status change — assigned, picked up, in transit, delivered, failed, cancelled, returned to pending (unassigned or reopened). Has `previousStatus` and `status`. |
| `delivery.delivered` | Completed with proof of delivery |
| `delivery.failed` | A delivery attempt failed (`delivery.failureReason`) |
| `delivery.cancelled` | Cancelled (in the app or via the API) |
| `delivery.rated` | The recipient rated the delivery on the tracking page. `data.rating` = `{ score (1–5), comment, ratedAt }` |
| `delivery.reschedule_requested` | The recipient asked for another delivery day. `data.reschedule` = `{ requestedFor, date, window, note, requestedAt }` — see [CUSTOMER-EXPERIENCE.md](CUSTOMER-EXPERIENCE.md) |
| `ping` | Only from "Send test event" |

One change can produce several events (e.g. completion → `delivery.status_changed` +
`delivery.delivered`); subscribe to what you need. Edits to details and deletion of
never-assigned deliveries don't send events. Events are queued in the same database
transaction as the change, so you never get an event for a change that didn't happen.

### Request

```
POST <your URL>
Content-Type: application/json
User-Agent: FleetFlow-Webhooks/1.0
FleetFlow-Event: delivery.status_changed
FleetFlow-Delivery: cmh0yq2b30007…          (this delivery attempt chain — same on retries)
FleetFlow-Signature: t=1793270400,v1=5f2b9c…
```

```json
{
  "id": "evt_9a1f0c2e7b5d4c3a2b1f0e9d",
  "type": "delivery.status_changed",
  "apiVersion": "v1",
  "createdAt": "2026-10-29T09:30:00.000Z",
  "data": {
    "delivery": { …the delivery object (§4)… },
    "previousStatus": "PICKED_UP",
    "status": "IN_TRANSIT"
  }
}
```

`data.previousStatus`/`data.status` are on every status event (not on `delivery.created`,
which has only `data.delivery`, nor on `delivery.rated` / `delivery.reschedule_requested`,
which carry `data.rating` / `data.reschedule` instead). `data.delivery` is the state when the
event was queued. `id` identifies the event (the same across your endpoints) — use it to
ignore duplicates. Delivery order isn't guaranteed; compare `delivery.updatedAt` if order
matters. `ping` has `data: { message, organization: { name }, endpointId }`.

Respond with any **2xx within 10 seconds** (do the work asynchronously). Redirects are
**not** followed — a 3xx counts as a failure.

### Verifying the signature

`v1` = hex HMAC-SHA256 of `"<t>.<raw request body>"`, keyed with the endpoint secret
(the whole `whsec_…` string, UTF-8). Verify against the **raw** body bytes (before JSON
parsing), compare in constant time, and reject timestamps more than 5 minutes off.
Accept the request if **any** `v1=` value matches (a future version may send more than one, e.g. during rotation). Rotating a secret takes effect immediately, including for queued retries.

**Node.js (Express)**

```js
const crypto = require("crypto");
const express = require("express");
const app = express();
const SECRET = process.env.FLEETFLOW_WEBHOOK_SECRET; // whsec_…

function verify(header, rawBody, secret, toleranceSec = 300) {
  const parts = Object.fromEntries((header || "").split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return (header.match(/v1=([0-9a-f]+)/g) || []).some((v) => {
    const given = Buffer.from(v.slice(3), "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

app.post("/fleetflow/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verify(req.get("FleetFlow-Signature"), raw, SECRET)) return res.status(400).send("bad signature");
  const event = JSON.parse(raw);
  res.sendStatus(204); // acknowledge first, then process
  setImmediate(() => handle(event)); // dedupe on event.id
});
```

**PHP (WordPress / WooCommerce)**

```php
<?php
function fleetflow_verify_signature(string $header, string $rawBody, string $secret, int $tolerance = 300): bool {
    $t = null; $sigs = [];
    foreach (explode(',', $header) as $part) {
        [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($k === 't') $t = (int) $v;
        if ($k === 'v1') $sigs[] = $v;
    }
    if (!$t || abs(time() - $t) > $tolerance) return false;
    $expected = hash_hmac('sha256', $t . '.' . $rawBody, $secret);
    foreach ($sigs as $sig) {
        if (hash_equals($expected, $sig)) return true;
    }
    return false;
}

// e.g. in a REST route callback (register_rest_route) or a plain endpoint:
$raw    = file_get_contents('php://input');                    // raw body — before json_decode
$header = $_SERVER['HTTP_FLEETFLOW_SIGNATURE'] ?? '';
if (!fleetflow_verify_signature($header, $raw, get_option('fleetflow_webhook_secret'))) {
    http_response_code(400);
    exit('bad signature');
}
$event = json_decode($raw, true);
// if ($event['type'] === 'delivery.delivered') { $order = wc_get_order(...$event['data']['delivery']['externalRef']); $order->update_status('completed'); }
http_response_code(204);
```

### Retries, failures and auto-disable

- Sent right after the change commits; retried on any non-2xx, timeout or network error.
- **8 attempts**: the first, then after **30 s, 2 min, 10 min, 1 h, 3 h, 6 h, 12 h**
  (≈ 22 h). Then the delivery is marked **Failed** — use **Retry now** in Settings to
  send it again (it's re-signed with a fresh timestamp; same body and `FleetFlow-Delivery`).
- Retries are sent when the company has activity and by a scheduled sweep (on the
  current hosting plan the sweep runs once a day, so retries for an otherwise idle
  company can run late).
- After **20 failed attempts in a row** (across events) the endpoint is **disabled
  automatically** and company admins get an in-app notification. Fix the receiver, then
  re-enable it (this resets the counter). A success resets it too. `ping` never counts.
- Delivery history is kept 30 days.

### Where webhooks can go (SSRF protection)

- `https://` only. `http://localhost` / `127.0.0.1` / `[::1]` are accepted only on
  non-production deployments (local testing).
- No credentials in the URL; no internal names (`localhost`, `*.local`, `*.internal`, …).
- The host is resolved **at send time** and refused if any address is private,
  loopback, link-local (incl. cloud metadata `169.254.169.254`), CGNAT, multicast,
  documentation/reserved, NAT64 or 6to4; the connection goes to the address that was
  checked (no DNS rebinding).
- No redirects, 10 s timeout, at most 2 KB of the response is read; at most 1 KB of
  error text is stored.

## 8. Changelog

- **v1** (2026-10) — API keys, deliveries create/list/get/cancel, `GET /me`, webhooks.
- **v1** (2026-10, additive) — `weightKg` on create; `weightKg`, `deliveryFeeBdt` and `zone` on the delivery object (API responses and webhook payloads).
