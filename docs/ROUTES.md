# Route planning

Dispatchers and admins can put a driver's open deliveries in a sensible
stop order and give each stop an arrival estimate. Available on plans with
the **Live map & routes** feature (`live_map`); the server refuses route
planning (403) on other plans. Drivers always see a saved order, whatever
the plan.

Where: **Dispatch → On the road → Route** (next to each driver). The
dialog lists the driver's open stops (`ASSIGNED`, `PICKED_UP`,
`IN_TRANSIT`) in order with arrival times, the estimated total distance and
time, an **Optimise route** button, and up/down buttons to reorder by hand
(**Save order**). Stops with no map location are listed with a
**Locate on map** link to the delivery.

## What is saved

Saving (optimise or manual) writes, for every open stop, in one transaction:

| Field | Meaning |
|---|---|
| `Delivery.routeSeq` | Stop number in the driver's route, 1 = next |
| `Delivery.plannedEta` | Estimated arrival (null if the stop has no map location) |
| `Delivery.routePlannedAt` | When the order was saved |

Both actions are audit-logged (`ROUTE_OPTIMIZED`, `ROUTE_REORDERED`).

When a delivery leaves the driver — unassigned, delivered, failed or
cancelled — its fields are cleared and the driver's later stops move up
(stop 4 becomes 3), so `routeSeq` stays 1, 2, 3… Newly assigned deliveries
have no stop number until the route is planned again. Estimates are **not**
recalculated automatically as the day goes on; optimise again to refresh
them.

`routeSeq`/`plannedEta` are in the app's delivery data (Deliveries list and
detail show "Stop 3 · ETA 2:20 PM"), the driver app (jobs follow the route
order, cards show the stop and ETA) and the public API as
`route: { stop, eta }` (docs/API.md).

## The heuristic (src/lib/route-optimizer.ts)

1. **Start point** — the driver's GPS position if it is fresh (newer than
   `LIVE_LOCATION_MAX_AGE_MS`, 10 min), otherwise the company depot
   (`Organization.pickupLat/Lng`), otherwise the first stop that has a map
   location.
2. **In-transit stops stay first.** A stop the driver already set off for
   (`IN_TRANSIT`) is not reordered. Parcels already picked up are otherwise
   ordinary stops; `ASSIGNED` parcels are assumed to be collected at the
   start point (pickups are not modelled as separate stops).
3. **Priority tiers.** URGENT and HIGH stops come before NORMAL and LOW
   ones. Hard tiers rather than a distance discount, so "urgent goes first"
   holds whatever the geography; only two tiers so the route doesn't cross
   town four times.
4. **Nearest neighbour, then 2-opt.** Each tier is seeded by repeatedly
   going to the closest remaining stop, then the whole route is improved
   with 2-opt (reverse any stretch that shortens the route) on estimated
   road distance. Moves never mix tiers and are only taken when they
   shorten the route, so the result is never longer than the seed.
5. **No map location → last**, in their current order, then by expected
   time. They get no estimate.

The result is deterministic (same stops → same order) and takes a few
milliseconds for 150 stops. It is a heuristic, not an exact solver: it
ignores delivery time windows, traffic and one-way streets.

## Estimates (src/lib/geo.ts)

- **Distance**: straight-line (haversine) distance × `ROAD_FACTOR` (1.35)
  to approximate city roads.
- **Speed**: `DEFAULT_SPEED_KMH` (18 km/h door-to-door city average).
- **Time at each stop**: `STOP_SERVICE_MINUTES` (6 min — parking,
  handover, proof of delivery).
- Departure is the moment the route is saved. A stop without coordinates
  adds no time, so estimates after it may be early.

These are **estimates** for ordering stops and giving customers a rough
window — not navigation and not a promise. Show them as "ETA", never as a
guaranteed time.

## API (staff only, `live_map`)

| Method | Path | Body | |
|---|---|---|---|
| GET | `/api/routes?driverId=` | — | Open stops in route order (unplanned last), saved ETAs, live distance/time totals, start point used |
| POST | `/api/routes/optimize` | `{ driverId }` | Optimise and save; returns the plan |
| PUT | `/api/routes` | `{ driverId, order: deliveryId[] }` | Save a manual order — must list exactly the driver's open stops; returns the plan |

Saving locks the driver's open deliveries and the driver (same lock order
as dispatch); if a stop was assigned or closed meanwhile the request fails
with 409 "refresh and try again".
