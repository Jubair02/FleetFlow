# Delivery zones & charges

Every company sets its own price list in **Settings → Zones & charges** (admins only;
available on every plan). FleetFlow uses it to put each delivery in a zone and work out
its **delivery charge** — what the company bills the sender, in whole taka. The rules
live in `src/lib/zones.ts` (pure, unit tested in `tests/unit/zones.test.ts`).

## Zones

A zone has a name, a list of **areas** (keywords such as `Dhanmondi`, `Mirpur 10`,
`Savar`, `ধানমন্ডি`), and a price:

| Field | Meaning |
|---|---|
| Base charge | Price of a parcel up to the included weight |
| Weight included (kg) | Default 1 kg |
| Per extra kg | Added for **each started kg** above the included weight |
| COD fee % / minimum | On cash-on-delivery orders: `max(minimum, round(COD × % / 100))` |
| Default | The fallback zone (at most one per company — setting a new default clears the old one) |
| Active | Turned-off zones are never matched or offered, but deliveries already in them keep their price |
| Order | Zones are tried top to bottom (up/down arrows in Settings) |

**Starter zones** (one click when the list is empty): *Inside Dhaka* ৳60 (Dhaka city
thanas/areas in English and Bangla), *Dhaka suburbs* ৳100 (Savar, Ashulia, Keraniganj,
Gazipur, Tongi, Narayanganj …) and *Outside Dhaka* ৳120 as the default; 1 kg included,
৳15–20 per extra kg, 1% COD fee. Change any of it afterwards. The starter lists
deliberately leave out the bare word "Dhaka" (it also appears in suburb addresses);
add it to *Inside Dhaka* if your customers often write only "…, Dhaka".

## Matching an address

1. The address and each keyword are normalized the same way: lower case, Bangla digits
   → ASCII, letters and digits split apart (`Mirpur-10`, `Mirpur10` → `mirpur 10`),
   all punctuation and repeated spaces → one space.
2. A keyword matches when its words appear as **whole, consecutive words** of the
   address: `Mirpur` matches "Mirpur 10" and "Mirpur-10, Dhaka" but not "Mirpurkhas";
   `Mirpur 10` matches "Mirpur-10" but not "Mirpur 1"; `Sher-e-Bangla Nagar` matches
   "Sher e Bangla Nagar". Bangla keywords work the same (whole words, so `মিরপুর`
   does not match the inflected `মিরপুরে`).
3. The first **active** zone in order (then by name) with a matching keyword wins.
4. Otherwise the active **default** zone is used.
5. No match and no default (or no zones at all) → no zone, **no charge** (`null`).

Use **Test an address** in Settings to check an address before relying on it.

## The charge

```
charge = base
       + ceil(max(0, weight − included kg)) × per-extra-kg
       + (COD > 0 ? max(COD minimum, round(COD × COD% / 100)) : 0)
```

Example (Inside Dhaka: ৳60, 1 kg included, ৳15/kg, 1% COD): a 2.3 kg parcel with
৳1,250 to collect → 60 + 2 × 15 + 13 = **৳103**. The delivery form shows this
breakdown live (`POST /api/zones/preview`).

## When the charge is (re)calculated

- **On create** — always (in the app, CSV import and the public API).
- **On edit** of an open delivery — when the address, weight, COD amount or zone change.
  Changing the address re-matches the zone unless a zone is picked in the same edit.
- **Staff override** — staff can pick a zone by hand (overrides matching) and/or type a
  charge. A typed charge (`feeOverridden`) is never recalculated; clearing it goes back
  to the zone price.
- **Finished deliveries** (delivered, failed, cancelled) keep their zone and charge;
  only an explicit zone/charge edit changes them (delivered/cancelled ones can't be
  edited at all).
- **Zone prices changed?** Existing deliveries keep their charge. *Re-price open
  deliveries* in Settings (`POST /api/zones/recalculate`, admin) applies the current
  prices to open deliveries without a typed charge: each keeps its zone (manual picks
  stay); one with no zone is matched now. It runs in bounded batches of 500.
- **Deleting a zone** is allowed: deliveries in it keep their charge and lose the zone
  link (shown as "Deleted zone"/"No zone" in reports). Turning the zone off keeps them
  linked — the settings screen suggests that when the zone has open deliveries.

## Where it shows up

- Delivery form: Weight (kg), Zone (`Auto: <matched zone>` by default), live charge
  breakdown, *Override charge*.
- Delivery details and the deliveries list: charge and zone (staff only; drivers don't see charges).
- CSV import: optional `weight_kg` and `delivery_fee` columns (`delivery_fee` = typed
  charge; blank = calculated).
- Public API & webhooks: `weightKg` on create; `weightKg`, `deliveryFeeBdt`, `zone` on
  the delivery object (docs/API.md).
- Reports: total charges in the range (cancelled excluded), charges on delivered
  orders, and a per-zone breakdown (deliveries, delivered, charges). Computed with a SQL
  aggregate over the whole filter, so it is never truncated. The CSV export has
  *Zone* and *Delivery charge* columns.

## API (company app, org-scoped)

| Route | Who | |
|---|---|---|
| `GET /api/zones` | admin, dispatcher | zones in order, with open-delivery counts |
| `POST /api/zones` | admin | create (audited `ZONE_CREATED`) |
| `PATCH /api/zones/{id}` | admin | edit (audited `ZONE_UPDATED`) |
| `DELETE /api/zones/{id}` | admin | delete (audited `ZONE_DELETED`) |
| `POST /api/zones/reorder` `{ ids }` | admin | new order; must list every zone once |
| `POST /api/zones/starter` | admin | add the starter zones (skips existing names) |
| `POST /api/zones/preview` `{ address, weightKg?, codAmount?, zoneId? }` | admin, dispatcher | matched zone + charge breakdown, read-only |
| `POST /api/zones/recalculate` `{ cursor? }` | admin | re-price one batch of open deliveries; repeat with `nextCursor` |

`POST /api/deliveries` and `PATCH /api/deliveries/{id}` accept `weightKg`, `zoneId`
(`null` = automatic) and `deliveryFeeBdt` (a number = typed charge, `null` = remove it).
