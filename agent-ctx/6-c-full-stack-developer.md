# Task 6-c — full-stack-developer — Drivers / Vehicles / Notifications / Audit views

## Scope
Implemented exactly four files (no other files touched):
- `src/components/fleetflow/drivers-view.tsx`
- `src/components/fleetflow/vehicles-view.tsx`
- `src/components/fleetflow/notifications-view.tsx`
- `src/components/fleetflow/audit-view.tsx`

## What was built

### DriversView
- `useApiData<{ items: DriverItem[] }>("/api/drivers")`; header + "Add driver" (UserPlus).
- Card grid `md:grid-cols-2 xl:grid-cols-3 gap-4`, `p-5`: Avatar initials (bg-primary/10 text-primary), name/email, active Switch.
- Turning OFF → controlled AlertDialog ("Deactivate {name}? …signed out immediately…") → `PATCH /api/drivers/{id} { active: false }`; turning ON → direct patch. Server rejection ("Driver has N active job(s)…") surfaced via `toast.error`. Controlled Switch reverts automatically on failure.
- Phone + license (mono) rows w/ Phone/IdCard icons; AvailabilityBadge; Progress = activeJobs/maxActiveJobs*100 (amber indicator at capacity via `[&_[data-slot=progress-indicator]]:bg-amber-500`, otherwise primary emerald); inactive → `opacity-60` + zinc "Deactivated" badge; emerald/rose completed/failed stats; Edit outline sm Button → Dialog (name, phone, licenseNumber, availability Select, maxActiveJobs 1–10) → PATCH → toast + bump + reload.
- Add driver Dialog: name/email/password (type=text mono + demo hint)/phone/license/maxActiveJobs (default 3). Validation: all required + password ≥ 8. POST → `toast.success("Driver account created for {name}")` + bump + close + reset.
- Skeletons (6 cards), empty state (Users icon + CTA), error card.

### VehiclesView
- Summary chips: X active (emerald) · Y maintenance (amber) · Z inactive (zinc).
- Desktop table in Card (`hidden md:block`, min-w-820, overflow-x-auto) + mobile cards (`md:hidden`).
- Columns: registration (mono medium), type icon+VehicleTypeLabel (VAN=Truck, BOX_TRUCK=Container, MOTORCYCLE=Bike, CAR=Car, REFRIGERATED=Snowflake), capacity, VehicleStatusBadge, active jobs (emerald count), notes (truncate + full note text-xs under when MAINTENANCE), actions.
- DropdownMenu (MoreHorizontal): Edit details; Send to maintenance (ACTIVE only); Return to service (MAINTENANCE only); Deactivate (ACTIVE only); separator; Delete (destructive when activeJobs===0, otherwise disabled with "Blocked — N active jobs" hint). Status changes via `PATCH { status }` → toast + bump; blocked-with-active-jobs errors surfaced.
- Register/Edit shared Dialog (registrationNumber, type Select, capacity placeholder "e.g. 1.2 t / 8 m³", notes Textarea) → POST/PATCH. Delete → AlertDialog "Delete {reg}? This cannot be undone." → `api.del` (history-rejection surfaced).
- Skeletons / empty state / error card.

### NotificationsView
- Role from `useAppStore` session. In-app: `useApiData<{ items; unread }>("/api/notifications")`. Admins additionally fetch `"/api/notifications?channel=EMAIL"` (drivers pass `null` → no request).
- Admin: Tabs defaultValue="in-app" — "In-app" (Bell + unread count badge when > 0) and "Email outbox" (Mail) with explainer line about simulated email (Resend/SendGrid/SES) + table (To mono, Subject, Body truncate, Sent = formatDateTime + timeAgo, type badge w/ type tint), empty state text as specced. Driver: plain in-app list, no tabs.
- In-app list: `max-h-[600px] overflow-y-auto divide-y`; per-type icon circles (NEW_ASSIGNMENT emerald, UNASSIGNED zinc, PICKED_UP teal, IN_TRANSIT cyan, DELIVERED emerald, FAILED rose, POD_UPLOADED amber ImageIcon, default Bell zinc); unread → `bg-primary/5` + emerald dot + font-semibold title. Click w/ deliveryId → `POST /api/notifications/read { ids: [id] }` then admin `goToDelivery` / driver `focusDelivery + setView("driver-jobs")`.
- "Mark all as read" (CheckCheck, disabled at 0 unread) → `{ all: true }` → toast + bump + reload. Skeletons + empty states.

### AuditView
- Filters: entityType Select ("All types"/Delivery/User/Vehicle — values match API casing), action search Input (placeholder "Filter by action e.g. DRIVER_ASSIGNED", committed on Enter/Apply — not per keystroke), Reset. Page state; URL built with URLSearchParams; `useApiData(url, [page])`.
- Table: Time (formatDateTime + timeAgo), Actor (size-6 initials Avatar + name), Action (mono text-xs Badge tinted: CREATED/REGISTERED emerald, OVERRIDE amber, FAILED/DELETED/CANCELLED rose, else zinc), Entity (type + truncated mono id), Detail (truncate → Popover with pretty-printed JSON in `pre` bg-muted rounded p-3 text-xs max-h-64 overflow-auto, try/catch fallback to raw string).
- Pagination footer: "{total} records" + Prev/Next (disabled at bounds, min-h-11 mobile) + "Page X of Y". Empty: ScrollText + "No audit entries match your filters." Skeleton rows while loading.

## Verification
- `bunx tsc --noEmit`: **0 errors in the four files** (remaining project errors are in other agents' in-flight files, e.g. delivery-detail-dialog.tsx).
- dev.log: clean compiles, `GET / 200`; earlier transient module-not-found lines were mid-write artifacts only.
- curl smoke tests (admin session): `/api/audit?entityType=Delivery`, `/api/notifications`, `/api/notifications?channel=EMAIL` all 200 with shapes exactly matching the view types.

## Conventions for following agents
- All mutations: try/catch → `toast.success`/`toast.error(e.message)` → `useAppStore.getState().bump()` + local `reload()`.
- Touch targets: `min-h-11 sm:min-h-9/10` pattern on buttons; icon menu triggers `size-11 sm:size-9`.
- No raw blue/indigo; emerald semantic tokens + tinted outline badges with dark: variants.
- Long lists: `max-h-[600px] overflow-y-auto`.
