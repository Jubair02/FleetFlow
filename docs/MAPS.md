# Maps, geocoding & live driver location

FleetFlow puts deliveries, the depot and drivers on a map. Address lookup and map tiles
come from **[Barikoi](https://barikoi.com)** (Bangladesh). Everything works without a
Barikoi key — it just does less.

## Environment variables

| Variable | Where it's used | Without it |
|---|---|---|
| `BARIKOI_API_KEY` | **Server only.** Geocoding delivery addresses (Rupantor), the pin picker's address search (autocomplete), reverse geocoding. Never sent to the browser. | No address lookups: deliveries appear on the map only when someone drops a pin, the API sends `location`, or the driver records proof of delivery with GPS. The search box in the pin picker is hidden. |
| `BARIKOI_MAP_KEY` | **Browser.** The map style (`https://map.barikoi.com/styles/osm-liberty/style.json?key=…`; `barikoi-dark` in dark mode). Anyone who opens a map can see it. Falls back to `BARIKOI_API_KEY`. | Maps draw OpenStreetMap's raster tiles (`tile.openstreetmap.org`, "© OpenStreetMap contributors"). Fine for development; OSM's tile policy doesn't allow heavy production use. |

**Use two keys in production**: a server key for `BARIKOI_API_KEY`, and a separate
browser key for `BARIKOI_MAP_KEY` restricted to your domain in the Barikoi dashboard
(the app sends `Referrer-Policy: strict-origin` — the site origin only, never the path — so a domain restriction works).

The Content-Security-Policy (`next.config.ts`) allows `*.barikoi.com`, `barikoi.xyz`,
`*.barikoi.xyz` and `tile.openstreetmap.org` in `connect-src`/`img-src`; MapLibre's
worker runs from `blob:` (`worker-src`). Code: `src/lib/barikoi.ts`, `src/lib/geocoding.ts`,
`src/lib/live-location.ts`, UI in `src/components/fleetflow/map/` (MapLibre GL is loaded
lazily — it is never part of the main bundle).

## Where a delivery is (`geoSource`)

| Source | Set by | Replaced by an address lookup? |
|---|---|---|
| `PIN` | Staff, "Pin on map" in the delivery form | Never |
| `API` | Public API `location: { lat, lng }` (docs/API.md) | Never |
| `DRIVER` | Driver's GPS when recording proof of delivery, if the delivery had no point yet | Never |
| `GEOCODED` | Barikoi lookup of the delivery address | Yes — editing the address clears it and looks it up again |

- New deliveries (app, CSV import, public API) without a point are geocoded **after the
  response** (`after()`), 4 at a time, at most 100 per request.
- The daily cron (`/api/cron/daily`) geocodes up to 200 open deliveries that were never
  looked up. `geocodeAttemptedAt` is stamped even when nothing is found, so a bad
  address isn't retried forever. Without `BARIKOI_API_KEY` nothing is stamped, so adding
  a key later lets the cron catch up.
- Results with Barikoi confidence below 40 % or outside Bangladesh are discarded.
- **Locate** (delivery detail → Locate, `POST /api/deliveries/[id]/locate`) forces a new
  lookup for a missing or `GEOCODED` point.
- The company's depot / pickup point is set in Settings → Company → "Pickup point on the
  map" (`Organization.pickupLat/pickupLng`); route planning starts there.

## Live driver location (plan feature `live_map`)

- The driver app shares the driver's position **only while they hold a delivery that is
  picked up or in transit**, and only while the app is open and visible — about every
  30 s. The driver sees "Sharing location with dispatch" whenever it does.
- The server refuses positions from drivers with no picked-up / in-transit job (409),
  from companies whose plan lacks `live_map` (403 — the app then stops), and more than
  one fix per 15 s (429).
- **No history is stored**: one row per driver (`DriverLocation`) holds the latest fix.
  It is deleted when the driver finishes or loses their last in-progress job, and the
  daily cron deletes anything older than a day. A position older than 10 minutes is never
  shown as live.
- **Dispatch** (admins & dispatchers): the **Live Map** screen (`/map`) shows drivers with
  a fresh position, open deliveries coloured by status, the depot, and — for a selected
  driver — their stops joined in route order (`routeSeq` from route planning). It
  refreshes every 30 s.

## What customers see

On the public tracking page, while **their own** delivery is picked up or in transit and
the sender's plan includes `live_map`, the page shows the courier's position on a small
map with an estimated arrival time (`GET /api/track/[token]/live`, polled every 30 s).
The estimate is straight-line distance × 1.35 at city speed, plus 6 minutes for each of
the driver's earlier stops in the planned route — an estimate, not navigation.

Customers **never** see the driver's name, phone, vehicle, other stops or any position
once the delivery is no longer in progress. The endpoint is rate-limited per tracking
link and client.
