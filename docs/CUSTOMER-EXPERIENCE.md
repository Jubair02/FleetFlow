# Customer experience — tracking page branding, ratings, rescheduling

What a delivery recipient sees and can do on their public tracking link
(`/track/<token>`), and how the company handles it.

Code map: `src/lib/branding.ts` (colours, logo address, what branding applies),
`src/lib/customer-feedback.ts` (rating / reschedule rules, request schemas),
`src/lib/customer-feedback-service.ts` (server side), `src/lib/tracking.ts`
(the customer-safe payload), `src/components/fleetflow/tracking/tracking-feedback.tsx`
(public UI), `src/components/fleetflow/settings/tracking-tab.tsx` (Settings),
`src/components/fleetflow/customer-feedback-panel.tsx` (delivery detail).
Tests: `tests/unit/customer-experience.test.ts`.

Every customer-facing string is in English and Bangla (`tracking/i18n.ts`).

## 1. Branding (plan feature `branded_tracking`)

**Settings → Tracking page** (`/settings/tracking`, admins only):

| Setting | Rules |
|---|---|
| Logo | PNG, JPEG or WebP, ≤ 1 MB, checked by content (magic bytes). **SVG is refused** (it can carry script). Stored like proof-of-delivery files (Cloudinary private asset `fleetflow/brand/…`, or `storage/brand/` on local disk). Replacing or removing deletes the old file. |
| Accent colour | `#RRGGBB`, ten presets or any colour. The page never puts text on a colour that fails WCAG AA: `brandPalette()` darkens it until white text reaches 4.5:1 (hero, buttons, monogram) and lightens it for text on dark cards. Settings shows the contrast and the shade that will be used. |
| Message | ≤ 200 characters, shown on every tracking page ("A note from …"). |

- **Saving** a colour/message or uploading a logo needs the feature (403 otherwise).
  Clearing them and removing the logo work on every plan.
- **Rendering** checks the feature again on every request. If the plan loses it,
  the page falls back to FleetFlow styling — the company name and phone always show.
- The logo is served by `GET /api/brand/<orgId>/logo?v=<version>` (public, same-origin, so
  the CSP `img-src 'self'` covers it). It answers 404 unless the company has a logo **and**
  the feature. `v` is a hash of the storage key: a matching `v` is cached for a year
  (`immutable`), a new logo gets a new address; ETag/304 otherwise. Sent with
  `X-Content-Type-Options: nosniff` and a `default-src 'none'; sandbox` CSP.
- Changes are audited: `TRACKING_SETTINGS_UPDATED`, `TRACKING_LOGO_UPDATED`, `TRACKING_LOGO_REMOVED`.

APIs (admin): `GET`/`PATCH /api/settings/tracking`
`{ brandColor?, trackingMessage?, allowCustomerRating?, allowCustomerReschedule? }`,
`POST /api/settings/tracking/logo` (multipart `file`), `DELETE /api/settings/tracking/logo`.

## 2. Ratings (every plan; switch: "Ask for a rating after delivery")

- Shown once the delivery is **DELIVERED**, until **14 days after `completedAt`**, once per delivery.
- 1–5 stars + optional comment (≤ 500 characters).
- `POST /api/track/<token>/rating` `{ rating, comment? }` — public. A second rating → **409**
  (`already_rated`); too late → 409 `expired`; not delivered → 409; switched off → 403.
- Records `Delivery.rating / ratingComment / ratedAt`, an internal timeline entry `RATED`
  (not customer-visible), and the webhook **`delivery.rated`**. A rating of 1–2 stars sends
  admins/dispatchers an in-app notification.
- The page then shows only the stars (never the comment, in case the link is shared).
- Staff see the rating in the delivery detail dialog. **Reports** show the average, count and
  1–5 distribution for deliveries in the selected range, plus each driver's average
  (credited to the driver whose assignment delivered it).

## 3. Rescheduling (every plan; switch: "Let recipients ask for another day")

Customer side:

- Offered while the delivery is **CREATED, ASSIGNED or FAILED**, no request is waiting, and
  fewer than **3** requests were made for it (after that: "please contact the sender").
- A day from **tomorrow to +14 days in the company's timezone**, a window
  (any time / morning 9–12 / afternoon 12–17 / evening 17–21) and a note (≤ 300 characters).
- `POST /api/track/<token>/reschedule` `{ date: "YYYY-MM-DD", window, note? }` — public.
- Stores `rescheduleStatus = PENDING`, `rescheduleRequestedFor` (start of the window — local
  midnight for "any time"), window, note and time; adds a **customer-visible** timeline entry
  "You asked to reschedule" (with the customer's own note); notifies admins and dispatchers
  in-app **and by email** (deduplicated per request); webhook **`delivery.reschedule_requested`**.

Staff side (admin / dispatcher):

- The delivery shows a **Reschedule requested** badge and an accept/decline panel; the
  deliveries list has a "Reschedule requests" filter (`?status=RESCHEDULE_REQUESTED`, API
  `?reschedule=PENDING`) and a count chip; the dashboard's *Needs attention* lists waiting requests.
- `POST /api/deliveries/<id>/reschedule` `{ action: "accept" | "decline", expectedAt?, note? }`.
  - **accept** (only while CREATED / ASSIGNED / FAILED): sets `expectedAt` — by default the
    **end** of the requested window (expectedAt is a deadline: "expected by", and the on-time
    rate compares against it), or the date-only day for "any time". A **FAILED** delivery is
    reopened as **CREATED** (the same reopening the status override allows; the failed
    assignment is already closed) so it can be dispatched again — this sends
    `delivery.status_changed` FAILED → CREATED.
  - **decline**: records the answer.
  - Both add a customer-visible timeline entry (`RESCHEDULE_ACCEPTED` / `RESCHEDULE_DECLINED`)
    whose note is the optional *message to the customer*, an audit entry, and — when the
    delivery has a recipient email and the plan includes `customer_emails` — an email to the customer.
- After a decline the customer may ask again (up to the limit).

## 4. Public route protections

- Both public POST routes count **every attempt** per tracking link + client IP
  (RateLimit keys `track-rate:` / `track-reschedule:`, 5 per 15 minutes) → 429 with `Retry-After`.
- Same-origin only (the CSRF check in `src/proxy.ts`); revoked links → 410, unknown → 404.
- Errors return `{ error, code }`; the page translates `code`.
- Every change locks the delivery row and writes its event and webhook in one transaction.

## 5. Webhook events

| Event | `data` |
|---|---|
| `delivery.rated` | `{ delivery, rating: { score, comment, ratedAt } }` |
| `delivery.reschedule_requested` | `{ delivery, reschedule: { requestedFor, date, window, note, requestedAt } }` |

Subscribe in **Settings → API & webhooks** (see [API.md](API.md) §7).
