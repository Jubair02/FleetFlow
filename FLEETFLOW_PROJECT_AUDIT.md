# FleetFlow — Project Audit, Completion Report & Business Analysis

**Audit date:** 2026-10-21  **Repository:** `D:\My Projects\New\FleetFlow` (branch `main`)
**Audience:** the next developer or AI assistant taking FleetFlow into its next phase.

> **Read this first: provenance of the current code**
>
> - **Uncommitted work.** In the same working session as this audit (2026-10-20 → 21), the app was migrated from SQLite to PostgreSQL (Neon) and about 80 review findings were fixed. **None of that work is committed.** `git log` still shows only 3 auto-generated commits, and `git status` lists 105 changed paths.
> - **What this audit describes.** It describes the code as it is in the working tree now, not `HEAD`.
> - **What was not changed.** No application code, configuration, or data was changed during the audit itself. The only file written is this report.
> - **Secrets.** No secrets appear in this report. The database host is shown only as `*.neon.tech`.

---

## 1. Executive Summary

FleetFlow is a **connected full-stack application, not a prototype**. It is a Next.js 16 single-page app with ~25 REST API route handlers, backed by PostgreSQL through Prisma.

**Already built:**
- The full delivery loop works end to end:
  1. An admin creates a delivery.
  2. The admin assigns a driver and vehicle, with capacity and conflict checks.
  3. The driver advances the status from a phone-friendly portal.
  4. The driver uploads a signature or photo as proof of delivery.
  5. The admin sees completion, history, audit trail, reports, and a public customer tracking link.
- The data is multi-tenant (organization-scoped).

**Verification level:**
- Type checking, linting, schema validation, and a production build pass.
- The core workflow was exercised end to end on 2026-10-21: 58 scripted API checks and a browser walkthrough, run against an isolated copy of the database.
- That test script is **not in the repository**, and the repository has **no automated tests**, so this cannot be re-verified from the repo alone.

**Not built:**
- Organization sign-up and onboarding, admin user management.
- Password change or reset.
- Real email or SMS delivery: notifications are recorded in an "outbox" table only.
- Billing and subscriptions: an `Organization.plan` column exists but nothing reads it.
- Maps/GPS, maintenance schedules, and expenses.
- Deployment configuration, tests, and README.

**The most urgent issue is security, not features.** `src/components/fleetflow/login-view.tsx:16-19` hard-codes working credentials, including an **admin** account, for demo accounts that exist in the live Neon database. The login page offers them as one-click buttons. Anyone who can reach a deployed instance can sign in as an admin.

**Approximate weighted implementation score: 60 / 100** (method and uncertainty in §5).

| Readiness | Assessment |
|---|---|
| Internal demo | Ready |
| Real pilot | Not ready |
| Commercial product | Not ready |

---

## 2. Project Overview and Actual Tech Stack

| Aspect | Actual implementation (evidence) |
|---|---|
| Purpose | Fleet & delivery management for small logistics/courier/distribution businesses (`src/app/layout.tsx` metadata, `worklog.md`) |
| Frontend | Next.js **16.4.2** (App Router), React **19.3.1**, Tailwind CSS **4.3.3**, shadcn/ui (Radix) — 48 primitives in `src/components/ui/` |
| App structure | **Single page** at `/` (`src/app/page.tsx`). Views (dashboard, deliveries, …) are switched by a zustand store (`src/store/app-store.ts`), **not by URLs**. Public tracking is `/?track=<token>` |
| Backend | Next.js route handlers under `src/app/api/**` (REST, JSON). No separate server |
| Request filter | `src/proxy.ts` (Next 16 "Proxy", formerly middleware): rejects cross-origin writes to `/api/*` |
| Database / ORM | PostgreSQL on Neon (`*.neon.tech`, pooled connection) via Prisma **6.19.3** (`prisma/schema.prisma`, 11 models). Schema applied with `prisma db push` — **no migration history** |
| Validation | zod **4.6.7** (`src/lib/validation.ts`) |
| Charts / state | recharts 2.15.4, zustand 5.0.15, date-fns 4 |
| Auth | Custom: scrypt password hashes, DB-backed sessions (SHA-256 of token stored), httpOnly cookie `ff_session`, 7-day TTL (`src/lib/auth.ts`). No third-party auth |
| Roles | `ADMIN` (dispatcher) and `DRIVER` (`User.role` string). Customers have no accounts; they use unguessable tracking tokens |
| File storage | Proof-of-delivery images on **local disk** at `storage/pod/` (`src/lib/storage.ts`), served only via the authenticated `GET /api/pod/[id]` |
| External services | **None** besides the database. Email is simulated (`src/lib/notify.ts` writes `Notification` rows with `channel=EMAIL`) |
| Deployment | **No deployment configuration** in the repo. The previous hosting-template files (`.zscripts/`, `Caddyfile`, standalone output) were removed in this session |
| Scripts | `dev`, `build`, `start`, `lint`, `db:push`, `db:generate` (`package.json`). **No `test` script** |
| Languages | TypeScript (≈12.6k lines excluding UI primitives) |
| Runtime used for checks | Node v24.16.0, npm (Windows 11) |

**Classification:** a connected full-stack application with runtime-verified core flows. It is **not deployed**: no deployment evidence exists.

---

## 3. Repository Structure and Key Files

```
prisma/
  schema.prisma          11 models: Organization, User, Session, DriverProfile, Vehicle, Delivery,
                         Assignment(outcome), DeliveryEvent (append-only), ProofOfDelivery,
                         Notification, AuditLog
  seed.ts                DESTRUCTIVE demo seed — guarded by ALLOW_DESTRUCTIVE_SEED=1
src/proxy.ts             CSRF origin check for /api writes
src/app/
  layout.tsx, page.tsx   root layout; SPA router with role guard
  api/                   REST handlers (see §19 for the full route/guard table)
src/lib/
  auth.ts                hashing, sessions, cookie
  api-helpers.ts         requireUser/Admin/Driver, error→HTTP mapping, readJson, date/tz parsing
  delivery.ts            tracking codes/tokens, row-lock helpers, closeAssignment, availability sync
  constants.ts           status state machine, failure reasons, labels, driver read-access rule
  validation.ts          zod schemas for every write
  notify.ts              in-app + simulated email notifications, audit-row builder, bestEffort
  storage.ts             POD file storage (magic-byte check, 8 MB cap, path-traversal guard)
  rate-limit.ts          in-memory login throttle
  serializers.ts, types.ts  API DTOs and the frontend contract
  api-client.ts          fetch wrapper + useApiData hook (stale-response guard, 401 → sign-out)
src/components/fleetflow/  one file per view: dashboard, deliveries, delivery-detail-dialog,
                         delivery-form-dialog, assign-dialog, dispatch, drivers, vehicles, reports,
                         notifications, audit, driver-portal, tracking, login, app-shell
src/store/app-store.ts   session, current view, refresh key, navigation helpers
storage/pod/             POD images (git-ignored; contains customer signatures)
worklog.md               original build log from the AI builder (describes the old SQLite setup)
.env.example             placeholder DATABASE_URL (real .env is git-ignored and untracked)
```

---

## 4. Feature Completion Matrix

**Status legend**

| Status | Meaning |
|---|---|
| Complete | Implemented, and its core path was **observed working at runtime** |
| Partially Complete | Implemented, but with gaps that matter |
| Missing | Not implemented |
| Not Verified | Implemented in code but not exercised |

**Evidence legend**

| Tag | Meaning |
|---|---|
| **[RT]** | Runtime-observed on 2026-10-21: scripted API checks or a browser walkthrough, against an isolated copy of the data |
| **[CI]** | Code inspection only |

| # | Feature | Status | Evidence | Works | Gaps / incorrect | Next action | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Auth, logout, passwords, sessions | **Partially Complete** | `src/lib/auth.ts`, `src/app/api/auth/*`, `src/lib/rate-limit.ts` [RT] | Login/logout, hashed sessions, logout revokes the session, 7-day expiry, deactivated users blocked, per-account throttle (5 fails/15 min), equal-time response for unknown emails | **Demo credentials hard-coded on the login page** (`login-view.tsx:16-19`) and valid in the live DB; no password change; no reset or forgot-password; admins can't reset a driver's password (`updateDriverSchema` has no password); throttle is per-process memory | Remove the demo logins and disable the demo accounts; add change and reset password | **Critical** |
| 2 | Organization management & tenant isolation | **Partially Complete** | Every query is scoped by `organizationId`; cross-org reads return 404 [RT] | Isolation between 2 orgs verified | No sign-up, org creation, or org settings (name, timezone, logo); orgs exist only via seed or manual DB work; `Organization.plan` unused | Add sign-up/onboarding and org settings | High |
| 3 | Dashboard, KPIs, charts | **Complete** | `api/dashboard/route.ts`, `dashboard-view.tsx` [RT] | Live DB aggregates (no mock data), 14-day chart in the viewer's timezone, status donut, needs-attention lists with true counts, driver workload, recent activity | Timezone comes from the browser per request; there is no org-level timezone | Store the org timezone | Low |
| 4 | User management & RBAC | **Partially Complete** | Route guards (§19); role-gated views in `page.tsx` + `allowedViews` [RT] | ADMIN/DRIVER enforced server-side; drivers get 403 on admin APIs; the UI hides admin views from drivers | No UI or API to add, remove, or manage **admins**; only two fixed roles (no read-only, owner, or billing role) | Add admin invite/management | High |
| 5 | Driver management | **Complete** (core) | `api/drivers/*`, `drivers-view.tsx` [RT] | Create, edit, deactivate (blocked while the driver has active jobs), capacity limit, availability (ON_ROUTE derived from jobs), per-driver completed/failed stats from assignment outcomes | No password reset; no driver documents or licence expiry | Add a password-reset action | Medium |
| 6 | Vehicle management & availability | **Partially Complete** | `api/vehicles/*`, `vehicles-view.tsx` [RT] | Register (case-insensitive unique registration), edit, maintenance, deactivate, reactivate, delete only without history, one driver per vehicle at a time | Maintenance is just a status plus free-text note: no schedules, odometer, service dates, or expenses | See #17 | Medium |
| 7 | Delivery CRUD, search, filter, pagination | **Complete** | `api/deliveries/route.ts`, `api/deliveries/[id]/route.ts`, `deliveries-view.tsx`, `delivery-form-dialog.tsx` [RT] | Create, edit (not after delivered or cancelled), delete (only if never assigned), case-insensitive search, status/priority/driver/vehicle/date filters, stable pagination | No bulk import (CSV) or API for e-commerce integration; no customer email field | Add CSV import | Medium |
| 8 | Dispatch & assignment | **Complete** | `api/deliveries/[id]/assign`, `unassign`, `api/dispatch`, `dispatch-view.tsx`, `assign-dialog.tsx` [RT] | Priority-ordered queue; transactional assign with row locks (concurrent double-assign → exactly one success, verified); capacity, off-duty, inactive-vehicle and vehicle-in-use checks; unassign with reason | No route or geography awareness; no auto-dispatch | Later (Stage 5) | Low |
| 9 | Status workflow (Created→Assigned→Picked Up→In Transit→Delivered / Failed, + Cancelled) | **Complete** | `constants.ts` state machine, `api/deliveries/[id]/status/route.ts` [RT] | Driver-only valid transitions; DELIVERED requires the driver's own POD; FAILED requires a reason and keeps the driver's note; admin cancel; audited admin override with restricted targets; concurrent double-pickup → one success | Failed deliveries must be re-dispatched manually (no retry scheduling) | Low | Low |
| 10 | Driver interface & mobile | **Partially Complete** | `driver-portal-view.tsx`, bottom nav in `app-shell.tsx` [RT: browser at desktop size; 375 px layout checked in an earlier review] | Active jobs, status buttons, report-problem flow, history with the driver's own outcome, notifications | **Not tested on a real phone**; no offline support; no installable PWA; polling only (45 s bell) | Real-device QA; consider PWA/offline | Medium |
| 11 | Proof of delivery | **Partially Complete** | `api/deliveries/[id]/pod`, `api/pod/[id]`, `storage.ts` [RT upload/complete] | Signature canvas (multi-touch safe, white background) and/or photo; magic-byte type check; 9 MB request cap; ownership checked before saving; files served only to authorized users | Files are on **local disk** and will be lost on serverless or ephemeral hosting; no image compression; no GPS or time stamp beyond server time | Move to object storage | **High** |
| 12 | History, events, audit log | **Complete** | `DeliveryEvent` (append-only), `AuditLog`, `audit-view.tsx` [RT] | Per-delivery timeline, assignment history with outcomes, org audit log with filters (notes, POD uploads, overrides included) | No export of the audit log; no retention policy | Low | Low |
| 13 | Customer tracking links | **Partially Complete** | `api/track/[token]`, `tracking-view.tsx` [RT] | Public page via unguessable token; revoke, regenerate, restore; internal notes and driver identity hidden; cancelled state shown correctly | The link must be **copied manually**: no SMS or email to the customer (no customer email field; phone is stored but unused) | SMS/email the link | High (pilot) |
| 14 | Notifications & email | **Partially Complete** | `notify.ts`, `api/notifications/*`, bell in `app-shell.tsx` [RT] | In-app notifications for assignments, status changes, failures; mark read; email "outbox" view | **No email is actually sent** (no provider); no SMS; no push | Integrate an email/SMS provider | High (pilot) |
| 15 | Reports, analytics, CSV | **Complete** | `api/reports/route.ts`, `reports-view.tsx` [RT] | Uncapped summary KPIs, on-time rate, per-driver performance by assignment outcome, daily chart with zero-filled days, CSV export of all rows (formula-injection safe) | No scheduled or emailed reports; no cost or fuel metrics | Low | Low |
| 16 | Maps, route planning, GPS | **Missing** | No map/geo code or fields (searched `latitude/longitude/geoloc/leaflet/mapbox/google.maps`) | — | Addresses are free text only | Stage 5, only if customers ask | Low |
| 17 | Maintenance schedules & expenses | **Missing** | No schema fields (searched `expense/odometer/serviceDue`) | Status MAINTENANCE + note only | — | Stage 5 add-on | Low |
| 18 | Billing, plans, payments | **Missing** | `Organization.plan` exists but nothing reads it; no payment code | — | — | Stage 4 | Medium |
| 19 | Error handling, loading, validation, empty states | **Complete** (code) / partly [RT] | `api-helpers.ts` error mapping; zod on all writes; skeleton, error, retry, and empty states in views | Invalid input → 400/409/413/415 instead of 500 (verified for dates, duplicates, oversized uploads, bad JSON); inline form errors | Every UI state wasn't exercised in a browser | Add UI tests | Medium |
| 20 | Security, accessibility, performance, deployment | **Partially Complete** | `proxy.ts`, `next.config.ts` headers [RT], `auth.ts`, rate limiting | CSRF origin check (403 verified), X-Frame-Options/CSP frame-ancestors/nosniff/HSTS/no-referrer, Secure cookie in production, hashed session tokens | Demo credentials (Critical); in-memory throttle; no monitoring or logging service; no deploy config; accessibility partly addressed (labels, aria) but not audited with tools | See §10 | Critical/High |
| + | SPA navigation | **Partially Complete** | `page.tsx`, `app-store.ts` [CI] | Role-guarded view switching | Views aren't in the URL: no deep links, the browser Back button doesn't move between views, and a refresh returns to the home view | Move views to App Router routes | Medium |

---

## 5. Completion Scores and Confidence Levels

**Method.**
- Each category is scored 0–100 by judgement against what a sellable small-fleet SaaS needs, using only the evidence above.
- Missing or unverified items count as **not done**.
- The scores are estimates, not measurements, with roughly ±10 points of uncertainty per category.

| Category | Weight | Score | Weighted | Basis |
|---|---|---|---|---|
| Core application & architecture | 10% | 75 | 7.5 | Coherent modular monolith, typed contract, row-locked transactions; loses points for URL-less SPA and no migrations |
| Authentication & security | 15% | 55 | 8.3 | Solid server-side guards and hardening, but live demo admin credentials, no password lifecycle, single-process throttle |
| Fleet management | 10% | 70 | 7.0 | Drivers and vehicles solid; no maintenance schedules, expenses, or driver password reset |
| Delivery management | 15% | 80 | 12.0 | Full CRUD, filters, edit, history; no import or integrations |
| Dispatch & workflow | 15% | 80 | 12.0 | Correct state machine, concurrency-safe; runtime-verified but not covered by repo tests |
| Driver experience & POD | 10% | 65 | 6.5 | Works in the browser; local-disk storage, no real-device test, no offline |
| Dashboard & reporting | 5% | 75 | 3.8 | Real aggregates, CSV; no scheduled reports |
| Testing & reliability | 10% | 15 | 1.5 | Type, lint and build pass; **zero automated tests in the repo** |
| Deployment & operations | 5% | 20 | 1.0 | No deploy config, README, monitoring, migrations or backups plan; work uncommitted |
| Business readiness | 5% | 10 | 0.5 | No onboarding, billing, real notifications; demo credentials |
| **Total** | 100% | | **≈ 60** | |

| Estimate | Value | Confidence | What would confirm it |
|---|---|---|---|
| Code implementation completion (MVP scope) | ~75% | Medium | Feature checklist reviewed against this matrix by the product owner |
| End-to-end functional completion | ~60% | Medium-low | A repeatable automated E2E suite in the repo, passing in CI |
| MVP readiness (internal demo) | High | Medium | Already demonstrable |
| Production readiness | ~30–35% | Medium | Stage 1 complete, deployed with object storage, migrations, monitoring, backups |
| Commercial readiness | ~10–15% | Medium | Onboarding, real notifications, billing or manual invoicing, a signed pilot |

---

## 6. Frontend, Backend, and Database Integration

- **No mock data in views.** Every view fetches through `useApiData` (`src/lib/api-client.ts`) from real API routes, which query Postgres via Prisma. Dashboard numbers are live aggregates (`api/dashboard/route.ts`).
- **Typed contract.**
  - `src/lib/types.ts` mirrors the server DTOs in `src/lib/serializers.ts`.
  - The header comment documents the query conventions: `from` is inclusive and `to` exclusive (both ISO instants), and `tz` is the viewer's timezone offset.
- **Data refresh.** After a mutation, views refetch through a global `refreshKey` (`bump()`). The hook discards out-of-order responses, and a 401 signs the user out.
- **Concurrency.**
  - Lifecycle writes take `SELECT … FOR UPDATE` row locks via `lockDelivery`, `lockDriver` and `lockVehicle` (`src/lib/delivery.ts`). The lock order is always Delivery → DriverProfile → Vehicle, which avoids deadlocks.
  - The raw lock SQL is schema-qualified, because Neon's pooler does not preserve `search_path`.
- **Assignment outcome.** `Assignment.outcome` (DELIVERED/FAILED/CANCELLED/UNASSIGNED) drives driver stats, driver history and report attribution.
- **Schema management.** The schema is managed with `prisma db push` and has **no migration history**. This is risky once production data exists, because changes are not reviewable or reversible.
- **Seed.** `prisma/seed.ts` wipes all tables; it is guarded by an environment flag.
- **Data provenance.** The live DB currently holds the demo dataset copied from the original SQLite file: 2 orgs, 8 users and 36 deliveries at migration time.

---

## 7. Authentication, Authorization, and Security Review

**In place** (observed unless marked [CI]):
- Passwords: scrypt with random salt, timing-safe compare, async so it doesn't block the server [CI].
- Sessions: DB-backed and revocable. Only a SHA-256 of the token is stored. Logout invalidates the session (replaying the old cookie gives 401).
- Cookie: httpOnly, SameSite=Lax, Secure in production [CI for Secure].
- Login hardening: 429 after 5 failed attempts on one account. Unknown and known emails take the same time to answer [CI].
- Every `/api` route has a guard (table in §19). Organization scoping is applied to every query. Cross-org reads → 404 [RT].
- Drivers can read only deliveries they currently hold or completed. They lose access after a reassignment [RT].
- CSRF: cross-origin writes are rejected (403); JSON bodies must be `application/json` (415).
- Security headers on all responses (`next.config.ts`).
- POD files: type checked by content, size-capped, served only via an authorized route, protected against path traversal.
- Public tracking exposes no driver, vehicle or internal-note data.
- `.env` is untracked and git-ignored. The Neon password was never committed: the only committed `.env` contained a local SQLite path.

**Weaknesses (ranked):**
1. **Critical — demo credentials.**
   - The login page (`login-view.tsx:16-19`) ships one-click logins for an admin, a driver, and a second-org admin.
   - Those accounts exist in the live DB with the same default passwords, which are also printed in `worklog.md` and `prisma/seed.ts`.
   - The app shell also says "Demo org" (`app-shell.tsx:335`).
2. **High — no password change, reset, or admin-initiated reset.** Compromised or forgotten passwords can't be handled inside the app.
3. **High — local-disk POD storage.** Customer signatures sit on the app server with no backup.
4. **Medium — in-memory login throttle.** It resets on restart and is not shared across instances.
5. **Medium — no email verification, MFA, or session list / "sign out everywhere".**
6. **Medium — no audit of logins or failed logins.**
7. **Low — no Content-Security-Policy beyond frame-ancestors.**

---

## 8. Testing and Verification Results

Commands run during this audit (read-only, or writing only build output to `.next/`):

| Command | Result | Summary | Observed / inferred |
|---|---|---|---|
| `npx prisma validate` | **Passed** | "The schema … is valid" | Observed |
| `npx tsc --noEmit` | **Passed** | exit 0, no errors | Observed |
| `npx eslint .` | **Passed** | exit 0, no problems | Observed |
| `npm run build` (`next build`) | **Passed** | Compiled; 17 static pages generated; Proxy registered | Observed |
| `npm test` | **Failed / N/A** | No `test` script; no test framework or test files exist | Observed |
| HTTP GET `/`, `/api`, `/api/auth/me` (unauthenticated, running dev server) | **Passed** | 200 | Observed |
| GET `/api/deliveries`, `/api/dashboard`, `/api/my/jobs`, `/api/pod/x` without a session | **Passed** | 401 | Observed |
| GET `/api/track/not-a-real-token` | **Passed** | 404 | Observed |
| POST `/api/deliveries` with a foreign `Origin` | **Passed** | 403 (CSRF proxy) | Observed |
| Security headers on `/` | **Passed** | X-Frame-Options DENY, CSP frame-ancestors 'none', nosniff, Referrer-Policy no-referrer, HSTS | Observed |

**No login was performed during the audit**, because a login writes a session row to the live database.

**Earlier in the same session (2026-10-21), not reproducible from the repo:**
- **Scripted API checks: 58 of 58 passed.** They covered:
  - auth (415, CSRF 403, 429 throttle, logout revocation);
  - filters and validation;
  - dispatch ordering;
  - concurrent double-assign and double-pickup (exactly one success each);
  - the full create → assign → pickup → transit → POD → delivered flow;
  - failure with note, reassignment access revocation, cancel;
  - delete rules, tenant isolation;
  - driver/vehicle safety checks;
  - email outbox, note auditing, and tracking privacy.
- **How they ran.** Against a temporary Postgres schema (`fleetflow_e2e`, since dropped) holding a copy of the data, with the dev server on port 3001.
- **Browser walkthrough.** All admin views, the driver portal and history, and the public tracking page (cancelled state) loaded with zero console errors or warnings.
- **Status.** The script lived in a scratch directory and is **not part of the repo**. Treat these results as one-time evidence, and port them into a real test suite (see §10, #4).

**How to verify database-dependent behaviour safely later:** create a Neon **branch** (or any disposable Postgres), point `DATABASE_URL` at it through a local env file that is never committed, run `npx prisma db push`, then seed with `ALLOW_DESTRUCTIVE_SEED=1` **only on that branch**. Then run the test suite. Never run the seed or destructive tests against the main branch.

---

## 9. Critical Bugs and Technical Debt

| Item | Type | Severity |
|---|---|---|
| Live demo credentials on the login page and in the DB | Security | Critical |
| All recent work (Postgres migration + ~80 fixes) uncommitted | Process / data-loss risk | Critical |
| No automated tests | Reliability | High |
| No password lifecycle (change/reset) | Missing core function | High |
| POD files on local disk | Deployability / data loss | High |
| `prisma db push` instead of migrations | Operations | High |
| No admin user management, onboarding, or org settings | Product gap | High |
| Notifications not actually delivered (email simulated, no SMS) | Product gap | High (for pilot) |
| URL-less SPA navigation (no deep links, Back button, or refresh-safe view) | UX debt | Medium |
| In-memory rate limiter | Scalability | Medium |
| No deployment config, README, monitoring, or backups plan | Operations | Medium |
| `worklog.md` describes the old SQLite stack and lists demo passwords | Documentation accuracy / hygiene | Low |

No mock dashboards, frontend-only features or broken routes were found in this audit. All views are wired to persisted data.

---

## 10. Top 15 Recommended Updates

The ordering weighs severity, business impact, effort (developer-days, approximate) and dependencies. None requires a rewrite.

| # | Update | Severity | Business impact | Effort | Depends on |
|---|---|---|---|---|---|
| 1 | Commit the current working tree to a private remote; confirm `.env` stays untracked | Critical | Prevents losing all recent work | 0.25 d | — |
| 2 | Remove the demo quick-login cards and "Demo org" copy; disable or re-password the demo accounts in the live DB | Critical | Prevents admin takeover of any deployed instance | 0.5 d | — |
| 3 | Password change (self-service) + admin "reset driver password" + forgot-password via email | High | Basic operability and security | 1.5–2 d | #9 for the email reset |
| 4 | Add an automated test suite (API integration tests + a few Playwright flows) against a disposable DB; add `npm test`; run in CI | High | Safe iteration | 3–4 d | Neon branch / test DB |
| 5 | Move POD storage to object storage (S3-compatible / Cloudflare R2 / Vercel Blob) behind the existing `savePodFile`/`readPodFile` interface | High | Required for any cloud deploy; protects customer proof | 1.5–2 d | Provider choice |
| 6 | Switch to Prisma Migrate (baseline the current schema) and document backups | High | Safe schema evolution on live data | 1 d | #1 |
| 7 | Org sign-up / onboarding: create org + first admin; org settings (name, timezone, logo) | High | Lets a pilot customer start without developer help | 2–3 d | #3 |
| 8 | Admin user management: invite or add admins, deactivate admins | High | Multi-dispatcher companies | 1.5–2 d | #7 |
| 9 | Real email provider (transactional) + SMS gateway for Bangladesh; send the tracking link to the customer automatically; add optional customer email | High (pilot) | The customer-facing value proposition | 2–3 d | Provider accounts |
| 10 | Deployment: choose a host, env docs, README, health check, error monitoring, log retention | Medium | Go-live | 1.5–2 d | #5, #6 |
| 11 | URL-based routing for views and delivery detail (deep links from notifications and emails, Back button) | Medium | Usability; needed for email links | 2–3 d | — |
| 12 | Shared rate limiter (DB- or Redis-backed) + login audit events | Medium | Security at scale | 1 d | #10 |
| 13 | Real-phone QA of the driver portal (Android low-end devices, slow 3G), image compression before upload, PWA install | Medium | Driver adoption | 2 d | #5 |
| 14 | Store the org timezone server-side and use it for reports, dashboards and emails | Medium | Correct numbers regardless of browser | 1 d | #7 |
| 15 | Update docs: replace `worklog.md` with an accurate README/architecture note; remove printed demo passwords | Low | Onboarding future developers | 0.5 d | #2 |

---

## 11. MVP Definition and Acceptance Criteria

**MVP:** a single logistics company can run its daily deliveries in FleetFlow on real phones, and its customers receive tracking links. It needs no developer involvement after setup.

Acceptance criteria (each needs an automated or documented manual test):
1. An owner signs up, creates the org, and invites at least one dispatcher and drivers. There are no demo credentials anywhere.
2. Users can change their password, and an admin can reset a driver's password.
3. An admin creates a delivery (or imports CSV — optional for the MVP) and assigns a driver and vehicle. Conflicts are rejected with clear messages.
4. The driver, on an Android phone over mobile data, sees the job, marks picked up and in transit, and captures a signature and/or photo. The delivery completes.
5. The customer automatically receives the tracking link (SMS and/or email). The page reflects status within one refresh.
6. The admin sees completion, POD and history. The dashboard and reports match the data.
7. POD files persist across redeploys (object storage). Data survives a restore from backup.
8. An automated test suite covering the above passes in CI.

---

## 12. Business Model and Pricing Hypotheses

**What the current product already solves.** It replaces WhatsApp, phone and spreadsheet dispatch with:
- assignment and capacity control;
- driver status updates;
- digital proof of delivery (dispute resolution);
- customer tracking links;
- an auditable history.

**What's missing before someone would reasonably pay:**
- self-onboarding;
- real SMS and email;
- password management;
- reliable hosting and storage;
- removal of the demo credentials.

**Revenue models assessed:**

| Model | Fit now | Notes |
|---|---|---|
| Monthly/annual subscription | Good | Simple to explain; offer an annual discount for cash flow |
| Per vehicle / driver / delivery volume | Good as tier *limits* | Vehicles/drivers are easy to count and are a proxy for company size; delivery volume tracks value but is harder to predict for buyers |
| Paid onboarding & data migration | Good early | Setting up drivers, vehicles and importing customers is real work; also a commitment signal |
| Premium reporting, integrations, support | Later | Needs integrations (e-commerce, accounting) that don't exist yet |
| Add-ons: GPS, route planning, maintenance analytics | Later | Not built; build only after paying customers request them |

**Illustrative BDT pricing.** This is a hypothesis to validate in interviews. No market data was available to this audit.

| Tier | Price / month (hypothesis) | Suggested limits | Rationale |
|---|---|---|---|
| Starter | ৳1,500 | Up to 5 drivers, 5 vehicles, ~500 deliveries/month, 1 admin, in-app + email notifications | Small courier or shop with its own riders; must cost less than the time saved by one dispatcher |
| Growth | ৳4,000 | Up to 20 drivers/vehicles, ~3,000 deliveries/month, 3 admins, SMS tracking links (with a fair-use SMS quota), CSV export/import | Distributors and e-commerce operations where customer updates matter |
| Business | ৳9,000 | Up to 50 drivers/vehicles, higher volume, unlimited admins, priority support, onboarding included | Multi-dispatcher operations; support is the main differentiator |

- **SMS is usage-based.** Price it as a pass-through or a quota, since it has a real per-message cost.
- **Onboarding fee.** A one-time ৳5,000–15,000 is also a hypothesis.

---

## 13. Revenue Scenarios and Operating Costs

**Tier mixes and average revenue per account (ARPA):**

| Scenario | Tier mix | ARPA (BDT/month) |
|---|---|---|
| Conservative | 80% Starter / 20% Growth | 0.8×1,500 + 0.2×4,000 = **2,000** |
| Moderate | 50% Starter / 40% Growth / 10% Business | 750 + 1,600 + 900 = **3,250** |
| Optimistic | 20% Starter / 50% Growth / 30% Business | 300 + 2,000 + 2,700 = **5,000** |

**Monthly recurring revenue (MRR = customers × ARPA):**

| Paying customers | Conservative MRR | Moderate MRR | Optimistic MRR |
|---|---|---|---|
| 5 | ৳10,000 | ৳16,250 | ৳25,000 |
| 10 | ৳20,000 | ৳32,500 | ৳50,000 |
| 20 | ৳40,000 | ৳65,000 | ৳100,000 |

- **Annual run-rate** = MRR × 12; for example, the moderate case with 10 customers gives ৳390,000/year.
- **These are revenue, not profit.** Profit = MRR − (fixed costs + usage costs + payment fees + support/sales time).
- **No customer-acquisition, conversion or churn data exists**, so the scenarios say nothing about *how likely* each customer count is.

**Cost structure** (amounts depend on the provider; get current quotes, because none were verified here):

| Cost | Type | Notes |
|---|---|---|
| App hosting | Fixed, plus usage at scale | A VPS or a managed platform; a small VPS keeps local disk, but managed platforms need #5 (object storage) |
| Database (Neon Postgres) | Fixed tier + usage (storage/compute) | A free tier may suffice for a pilot; paid tiers for backups/branching |
| Object storage for POD images | Usage-based (GB stored + egress) | Grows with photo uploads; compress images client-side |
| Email (transactional) | Usage-based, often with a free tier | Password reset, notifications |
| SMS (Bangladesh gateway) | Usage-based, per message | Likely the largest variable cost; pass it through to customers |
| Maps/geocoding (future) | Usage-based | Only if GPS or route features are built |
| Payment processing (bKash/Nagad/SSLCommerz/cards) | Percentage per transaction | Or invoice manually during the pilot |
| Domain, TLS, monitoring | Mostly fixed / low | |
| Customer support & onboarding | Time (fixed-ish per customer) | The real early cost |
| Sales | Time | Founder-led at first |
| Maintenance & development | Time | Ongoing |

---

## 14. Customer Validation and First-Customer Strategy

- **Minimum feature set to charge a first customer:**
  - §10 items #1, #2, #3, #5, #7 and #9;
  - a hosted deployment (#10);
  - backups.

  Billing can be a manual invoice plus bKash or bank transfer; no billing code is needed yet.
- **Free, paid, or postponed:**

  | Decision | Items |
  |---|---|
  | Free | The tracking page for end customers; a time-limited trial |
  | Paid | Seats, volume and SMS |
  | Postponed | GPS, route optimisation, maintenance and expenses, integrations, in-app billing |
- **Validate demand before spending heavily:**
  - interview 10–15 operators: couriers, distributors, and e-commerce businesses with their own riders;
  - show the working demo, using a separate demo deployment, not the production DB;
  - ask about their current process, the cost of failed deliveries and disputes, and dispatcher hours;
  - ask what they'd pay, and offer a paid pilot.
- **Interview guide (sample prompts):**
  - "Walk me through yesterday's dispatch."
  - "How do customers ask where their parcel is?"
  - "What happens when a delivery is disputed?"
  - "Who would use this daily?"
  - "What would make you stop using it?"
- **Getting pilot customers:**
  - offer 2–3 companies a 30–60-day pilot at a discount, with hands-on onboarding;
  - agree on success metrics up front and get a written commitment to pay if they are met.
- **Measuring time and money saved** (baseline before, then compare during the pilot):
  - dispatcher minutes per day;
  - "where is my parcel" calls;
  - failed-delivery rate;
  - dispute resolution time;
  - on-time rate, which FleetFlow already reports.
- **What differentiates FleetFlow from a generic CRUD dashboard:**
  - concurrency-safe dispatch with capacity and vehicle conflicts;
  - an enforced status workflow with an audit trail;
  - signature and photo proof of delivery;
  - privacy-safe customer tracking links;
  - per-driver accountability by assignment outcome.

  Localisation for Bangladesh (Bangla UI, local SMS, bKash) would strengthen this; it is not built.
- **Biggest commercial risks and assumptions:**
  - target firms will pay monthly instead of continuing with WhatsApp;
  - drivers will reliably use a web app on low-end phones;
  - SMS costs fit within the price;
  - competition from existing courier platforms and generic tools;
  - founder capacity for support.

---

## 15. Prioritized Product Roadmap

Effort is in developer-days, approximate, and based on the observed codebase.

**Unknowns:**
- choice of host, storage, email and SMS providers;
- whether Bangla localisation is required;
- the number of pilot customers.

### Stage 1 — Stabilize (≈ 5–7 d)

| | |
|---|---|
| **Tasks** | §10 items #1, #2, #4 (initial suite), #6, #15; separate a demo environment from production |
| **Dependencies** | A disposable test DB (Neon branch) |
| **Acceptance** | No credentials in the UI or docs; demo accounts disabled in production; `npm test` runs API + E2E tests green in CI; migrations baseline committed |
| **Risks** | Writing tests uncovers bugs (good, but adds time) |
| **Done when** | A fresh clone can install, migrate a test DB and pass all tests |

### Stage 2 — Complete the core MVP (≈ 8–12 d)

| | |
|---|---|
| **Tasks** | #3 password lifecycle, #5 object storage, #9 email + SMS + automatic tracking-link delivery, #11 URL routing, #13 real-phone QA and image compression |
| **Dependencies** | Provider accounts |
| **Acceptance** | All §11 criteria 2–8 met on a staging deployment |
| **Risks** | SMS gateway onboarding time; mobile browser quirks with camera/canvas |
| **Done when** | A staged run of a full day of deliveries by a test team succeeds |

### Stage 3 — Prepare for a paid pilot (≈ 6–9 d)

| | |
|---|---|
| **Tasks** | #7 onboarding and org settings, #8 admin management, #10 deployment and monitoring, #14 org timezone, #12 shared rate limiter; a feedback channel (in-app link/form); a pilot metrics view |
| **Acceptance** | A new company can self-onboard in under 30 minutes; uptime and error alerts configured; backups tested by restore |
| **Risks** | Onboarding scope creep |
| **Done when** | The first pilot company is live on production |

### Stage 4 — Monetization (≈ 5–8 d; only after pilots convert)

| | |
|---|---|
| **Tasks** | Use `Organization.plan`; enforce tier limits (drivers, vehicles, deliveries/month, SMS quota); billing page; payment integration (bKash/SSLCommerz or a card processor) or a manual-invoice workflow first; trial expiry |
| **Acceptance** | Limits enforced server-side with clear upgrade prompts; payments reconcile with plan changes |
| **Risks** | Payment-gateway approval time and fees |
| **Done when** | A customer can upgrade and pay without developer help |

### Stage 5 — Scale based on evidence (scope by demand)

| | |
|---|---|
| **Candidates** | Live GPS tracking (driver location pings + map), route planning/optimisation, maintenance schedules and expenses, CSV/API integrations with e-commerce platforms, Bangla UI, offline-capable driver PWA, advanced analytics |
| **Rule** | Build only items that at least two paying customers ask for, and measure usage after release |

---

## 16. Deployment and Production Readiness

| Check | State |
|---|---|
| Production build | Passes |
| Deployment config / host | **None** (template configs removed; `output: "standalone"` removed; `npm start` runs `next start`) |
| Environment variables | Only `DATABASE_URL` (documented in `.env.example`) |
| Schema management | `db push` — **switch to migrations** before live data changes |
| File storage | Local disk — **incompatible with serverless/ephemeral hosts** |
| Secrets | `.env` untracked ✔; demo credentials in UI and docs ✘ |
| Monitoring / alerting / logging | None |
| Backups | Depends on the Neon plan — **Not Verified** |
| Health check | `GET /api` returns 200 (a template route; could serve as a liveness probe) |
| HTTPS | Not applicable locally; the Secure cookie and HSTS activate in production |
| Multi-instance | Login throttle is per-instance; everything else is stateless (except local POD files) |

**Verdict:** not production-ready until Stage 1 and the storage, migrations and deployment items in Stage 2/3 are done.

---

## 17. Open Questions and Unverified Assumptions

- Is the data currently in Neon real customer data or only the demo dataset? (It matches the original demo seed.)
- Target hosting provider and budget?
- Is Bangla language support needed for drivers?
- Which SMS gateway and email provider?
- Will the business invoice manually at first, or does it need online payments from day one?
- Are drivers expected to use their own phones (BYOD)? Typical device and network?
- Neon plan: are point-in-time restore and backups enabled? **Not Verified.**
- Real-phone behaviour of signature capture and camera upload. **Not Verified.**
- Performance with large datasets (thousands of deliveries per org). **Not Verified**; queries are indexed and bounded, but no load test was done.

---

## 18. Recommended Next Development Task

**Do §10 #1 and #2 together (≈ 0.75 day):**
1. Commit the working tree to a private remote.
2. Remove the demo quick-login cards and "Demo org" banner (`login-view.tsx`, `app-shell.tsx`).
3. Disable or re-password the demo accounts in production through a one-off script run against production by the owner.
4. Remove the printed passwords from `worklog.md` and the `seed.ts` comments.

Then start Stage 1 testing (#4) on a Neon branch.

---

## 19. Evidence Appendix

**API routes and their guards** (from inspecting `src/app/api/**/route.ts`):

| Route | Methods | Guard |
|---|---|---|
| `auth/login` | POST | public (rate-limited) |
| `auth/logout` | POST | session (revokes) |
| `auth/me` | GET | session optional |
| `dashboard`, `dispatch`, `reports`, `audit` | GET | requireAdmin |
| `deliveries` | GET, POST | requireAdmin |
| `deliveries/[id]` | GET / PATCH, DELETE | requireUser + driver read rule / admin-only inside the handler |
| `deliveries/[id]/assign`, `unassign`, `tracking` | POST | requireAdmin |
| `deliveries/[id]/status`, `note` | POST | requireUser (driver must hold the active assignment; admin paths audited) |
| `deliveries/[id]/pod` | POST | requireDriver (active assignment holder) |
| `pod/[id]` | GET | requireUser + driver read rule |
| `my/jobs` | GET | requireDriver |
| `drivers`, `drivers/[id]`, `vehicles`, `vehicles/[id]` | GET/POST, PATCH(/DELETE) | requireAdmin |
| `notifications`, `notifications/read` | GET, POST | requireUser (own notifications; email outbox admin-only) |
| `track/[token]` | GET | public (token) |
| `/api` | GET | public health route |

**Key implementation references:**
- State machine and labels: `src/lib/constants.ts`
- Row locks, assignment closing and availability sync: `src/lib/delivery.ts`
- Error mapping and parameter parsing: `src/lib/api-helpers.ts`
- CSRF: `src/proxy.ts`
- Security headers: `next.config.ts`
- Demo credentials: `src/components/fleetflow/login-view.tsx:16-19`, `worklog.md`, `prisma/seed.ts`
- Unused plan field: `prisma/schema.prisma` (`Organization.plan`); no reads in `src/`
- Searches that returned no matches: maps/geo, expenses/odometer, payment providers, email providers, test files

**Test results:** see §8.

---

## Handoff Summary

- **Implemented:**
  - multi-tenant admin and driver web app on Next.js 16 + Prisma/Postgres;
  - deliveries CRUD and edit, dispatch with conflict and capacity checks;
  - an enforced status workflow with overrides;
  - driver portal with signature/photo proof of delivery;
  - public tracking links;
  - in-app notifications plus a simulated email outbox;
  - dashboard, reports with CSV, and an audit log.
- **Functional on evidence:**
  - type, lint, build and schema checks pass;
  - read-only runtime checks pass;
  - the full delivery loop, concurrency safety, tenant isolation and access rules passed 58 scripted checks plus a browser walkthrough on 2026-10-21. That script was not committed and no repo tests exist.
- **Five highest-priority issues:**
  1. demo admin credentials live on the login page and in the DB;
  2. all recent work is uncommitted;
  3. no automated tests;
  4. no password change or reset;
  5. POD files on local disk.
- **Next three tasks:**
  1. commit + remove the demo credentials;
  2. add a test suite against a Neon branch, plus migrations;
  3. password lifecycle + object storage for POD.
- **Shortest safe path to a working MVP:** Stage 1, then Stage 2 (§15), about 13–19 developer-days.
- **Minimum changes before a first paying customer:**
  - Stages 1–2;
  - onboarding and admin management;
  - real SMS/email tracking links;
  - a hosted deployment with backups;
  - manual invoicing.
- **Biggest business assumption to validate:** that small Bangladeshi delivery operators will pay a monthly fee to replace WhatsApp/phone dispatch, and that their drivers will use a web app on their own phones.
