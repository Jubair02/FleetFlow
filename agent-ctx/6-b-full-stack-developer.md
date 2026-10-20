# Task 6-b — DISPATCH-CORE UI (Deliveries view + Dispatch board + Assign/Detail dialogs)

Agent: full-stack-developer
Date: completed in this session

## Scope

Exactly four files created/modified (no other file touched):

1. `src/components/fleetflow/assign-dialog.tsx` — AssignDialog
2. `src/components/fleetflow/delivery-detail-dialog.tsx` — DeliveryDetailDialog
3. `src/components/fleetflow/deliveries-view.tsx` — DeliveriesView (replaced stub)
4. `src/components/fleetflow/dispatch-view.tsx` — DispatchView (replaced stub)

## Key decisions & implementation notes

- **AssignDialog**
  - Data via `useApiData<DispatchData>(open ? "/api/dispatch" : null)` — only fetches while open.
  - Driver options: `name — activeJobs/maxActiveJobs active · <availability label>`; disabled when
    `!active || OFF_DUTY || activeJobs >= maxActiveJobs` with amber hint ("· at capacity" / "· off duty" / "· inactive").
  - Vehicle options: `mono reg · <VehicleTypeLabel> · capacity`; non-ACTIVE vehicles rendered disabled with reason ("· in maintenance" / "· inactive").
  - Selected driver shows a small workload legend: Progress bar + "Workload: X/Y active jobs — available/on route/…".
  - Selections reset on every (re)open (`useEffect` on `open`/`delivery.id`); closing blocked while submitting.
  - Submit validates driver+vehicle, posts `/api/deliveries/{id}/assign`, toasts "Delivery dispatched",
    `bump()`, closes. Server conflict messages (e.g. "Driver is at capacity (3/3 active jobs)") surfaced via `toast.error(e.message)`.

- **DeliveryDetailDialog**
  - Fetches `/api/deliveries/{id}` only when `open && deliveryId`; skeleton while `loading || !data`.
  - Header: mono trackingCode + StatusBadge + PriorityBadge; description = recipient + truncated address.
  - Semantic `<dl>` info grid (sm:grid-cols-2): recipient w/ `tel:` link, pickup/delivery, expected (friendlyDueDate),
    created/completed (formatDateTime), instructions (col-span-2 italic), failure reason (rose, failureReasonLabel).
  - Current assignment card (driver · mono reg + vehicle type · assigned timeAgo) or muted "Not assigned".
  - Context-dependent actions: Assign (CREATED/FAILED), Unassign w/ optional reason (ASSIGNED/PICKED_UP/IN_TRANSIT),
    Cancel delivery w/ mandatory reason + red-ring validation, Add note (textarea + customerVisible checkbox),
    amber "Override (audited)" (target status select excluding current+ASSIGNED/CREATED, mandatory reason, failure-reason
    select when target FAILED, "Overrides are recorded in the audit log." note), ghost destructive Delete (CREATED only).
  - AlertDialog actions use `e.preventDefault()` so failed API calls keep the dialog open.
  - Tracking link card: read-only mono Input with `${origin}/?track=${token}` + Copy (clipboard + toast),
    Revoke/Restore + Regenerate buttons, amber "Link revoked — customer sees a 'revoked' message" note when disabled.
  - POD grid: `/api/pod/{id}` thumbnails (h-28, white bg, object-contain), PenLine/Camera kind icons, recipient,
    capturedAt; click opens large preview dialog. `eslint-disable-next-line @next/next/no-img-element` before each img.
  - Vertical event timeline (newest first, max-h-80 overflow-y-auto): STATUS_ICONS in colored circles (dot fallback),
    amber chip for OVERRIDE events, emerald "Customer-visible" chip, note + actor + formatDateTime + timeAgo.
  - All mutations go through one `runMutation` helper: try/catch → toast → `bump()` → `reload()`; `closeAll()` resets
    every sub-dialog state when the main dialog closes.

- **DeliveriesView**
  - Toolbar: debounced search (350 ms setTimeout), status/priority Selects ("ALL" sentinel — Radix forbids "" item values),
    spacer, "New delivery" primary button.
  - URL: `/api/deliveries?search&status&priority&page&pageSize=10`; page state resets on filter change;
    self-heals when `data.page > data.pageCount`.
  - Desktop table (hidden md:block, Card p-0, hover:bg-accent/50, row click + tracking-code button open detail) and
    mobile cards (md:hidden, keyboard-accessible role="button").
  - Pagination bar: "Showing X–Y of Z" + Previous/Next + "Page n of m" (plain buttons, not the pagination component);
    rendered under both layouts.
  - `focusDeliveryId` effect opens the detail dialog; closing it calls `focusDelivery(null)`.
  - Create dialog: name/phone/pickup/delivery/instructions/priority(NORMAL default)/datetime-local expectedAt
    (converted to ISO on submit, empty → null), manual required-field validation with red rings + inline errors,
    success toast includes the returned trackingCode; form fully reset on close.
  - Empty state: Package icon + "No deliveries match your filters." Loading: skeleton rows/cards.

- **DispatchView**
  - Stat chips (amber pending / rose failed-awaiting-reassignment / emerald active) as small tinted Cards with icons.
  - "Dispatch queue" card: table (md+) + cards (mobile); FAILED rows show failureReasonLabel under recipient (rose xs);
    overdue (expectedAt < now) shows rose "Overdue"; API order preserved (priority desc, expected asc);
    Assign (primary sm) opens AssignDialog with the row's delivery stored in state (cleared on close).
  - "On the road" card: driver w/ initials Avatar, mono reg + VehicleTypeLabel, StatusBadge, assigned timeAgo,
    Unassign (outline sm) → AlertDialog with optional reason → POST unassign → toast + bump (board refetches via refreshKey).
  - "Fleet snapshot" card (md:grid-cols-2): Drivers list (AvailabilityBadge, X/Y, Progress; off-duty rose-tinted,
    at-capacity amber-tinted, indicator recolored via `[&_[data-slot=progress-indicator]]:bg-*`) and Vehicles list
    (VehicleStatusBadge + active jobs, non-ACTIVE dimmed); both lists max-h-96 overflow-y-auto.
  - Empty states: "Queue is clear — every delivery is dispatched 🎉" / "No active assignments".

## Verification

- `tsc --noEmit`: zero errors in the four files (remaining project errors are in other agents'/pre-existing files:
  examples/, prisma/seed.ts, skills/, api status route).
- dev.log shows clean compiles; API smoke test (login → /api/dispatch → /api/deliveries) returns expected shapes.
- Did NOT run lint/build/dev server per task rules.

## Interfaces for other agents

- `AssignDialog({ delivery: Delivery | null; open: boolean; onOpenChange: (o: boolean) => void })` — reusable anywhere.
- `DeliveryDetailDialog({ deliveryId: string | null; open: boolean; onOpenChange })` — reusable; `goToDelivery(id)`
  from the store works via the DeliveriesView focus effect.
- Both views keep default + named exports (page.tsx uses named imports).
