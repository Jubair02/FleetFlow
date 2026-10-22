# FleetFlow billing — minimal subscription model

FleetFlow has **no payment gateway**. Plans live in the database, are edited by platform admins in the
**/platform → Plans** console, and are assigned to organizations by hand.
The prices are a **proposed hypothesis** that customer interviews have not yet tested.
This document describes the model, how limits and features are enforced, and the manual billing process.

Code references:
- `prisma/schema.prisma` → `model Plan`; `Organization.plan` is a foreign key to `Plan.code`.
- `src/lib/plan-catalog.ts` holds plan types, the feature catalog and labels (client-safe; no plan data).
- `src/lib/plans.ts` loads plans, counts usage and enforces limits/features (server only).
- `src/lib/platform-service.ts` holds the plan-management validation and rules (snapshot price, impact confirmation).
- `GET /api/plans` (public) lists the active public plans for the sign-up pricing table.
- `GET /api/billing` returns the organization's plan, usage and subscription for admins.
- `/api/platform/plans/**` and `PATCH /api/platform/organizations/[id]` (`set-plan`) are the platform admin APIs.
- `scripts/set-plan.mjs` assigns a plan from the command line (same rules as the console).

---

## 1. The model

- Each organization has exactly one plan: `Organization.plan` → `Plan.code` (enforced by a foreign key, so an organization can never point at a missing plan).
- A plan is a **subscription with resource limits and feature flags**, sold monthly and/or annually. There are no per-seat charges and no metered billing.
- Each organization also stores what it actually agreed to pay:
  - `billingCycle` — `MONTHLY` or `ANNUAL`;
  - `subscriptionPriceBdt` — the price per cycle **snapshotted when the plan was assigned** (`null` = free);
  - `planAssignedAt` — when that assignment happened.
- **Trial** is free (no monthly or annual price) and is the **default plan**: self-service sign-ups get the default plan on the monthly cycle. It has Growth-like limits so a prospect can evaluate with real data. It has no automatic end date (see §6).
- The billing contact is `Organization.contactEmail`, which the admin edits in organization settings.

### Managing plans (/platform → Plans)

Platform admins can, without a deploy:
- **Create** a plan: code (lowercase `a-z`, `0-9`, `-`, 2–32 chars, **immutable**), name, description, monthly/annual list price (empty = not sold on that cycle), the four limits (empty = unlimited), features, up to 8 highlight bullets, whether it is public (shown on the pricing table) and its sort order. New plans start **active** and **not default**.
- **Edit** any field except the code (see §3 for limit edits and §4 for price edits).
- **Activate / deactivate.** An inactive plan can't be newly assigned and disappears from the pricing table, but **existing subscribers keep it** — with its limits and features — until someone moves them. They may still change billing cycle or price while staying on it. The default plan can't be deactivated.
- **Make default.** The plan given to new self-service sign-ups. It must be active; exactly one plan is the default (a partial unique index enforces it).
- **Apply price to subscribers** (per billing cycle) — see §4.
- There is **no delete**. Plans are only deactivated, so history and audit rows stay meaningful.

Every change writes a platform audit row (`PLAN_CREATED`, `PLAN_UPDATED` with a field-by-field diff, `PLAN_ACTIVATED`, `PLAN_DEACTIVATED`, `PLAN_DEFAULT_CHANGED`, `PLAN_PRICE_APPLIED`).

### Feature flags

Only features that are actually enforced on the server exist (`FEATURES` in `src/lib/plan-catalog.ts`):

| Key | What it gates | Without it |
|---|---|---|
| `csv_import` | `POST /api/deliveries/import` (preview **and** commit) and the CSV template download | 403 "CSV delivery import isn't included in your … plan. Contact FleetFlow to upgrade." |
| `report_export` | `GET /api/reports?export=1` (CSV export). Viewing reports is never gated. | 403 with the same kind of upgrade message |
| `customer_emails` | Emails to delivery recipients: tracking link and delivered/failed outcome | Skipped silently — the delivery still succeeds, no error is shown |

Staff, driver and admin notifications (in-app and email) are **never** gated. `GET /api/org` returns `planInfo.features` so the UI can hide or explain gated actions, but the server check is what counts.

## 2. Plans and limits

The plans seeded by `prisma/manual-migrations/20261021_plan_management.sql` (the live values are whatever is in /platform → Plans now):

| Plan | Proposed price / month | / year | Active drivers | Vehicles in service | Admin/dispatcher accounts | Deliveries / month | Features |
|---|---|---|---|---|---|---|---|
| Trial (default, not public) | free | — | 10 | 10 | 3 | 1,000 | all |
| Starter | ৳1,500 | ৳15,000 | 5 | 5 | 1 | 500 | customer emails |
| Growth | ৳4,000 | ৳40,000 | 20 | 20 | 3 | 3,000 | all |
| Business | ৳9,000 | ৳90,000 | 50 | 50 | unlimited | 15,000 | all |

The annual prices (10× monthly, i.e. two months free) are a placeholder hypothesis.

How each resource is counted (`getUsage` in `src/lib/plans.ts`):
- **Active drivers:** users with role `DRIVER` and `active = true`.
- **Vehicles in service:** vehicles whose status is not `INACTIVE`. Vehicles in maintenance count.
- **Admin accounts:** users with role `ADMIN` and `active = true`.
- **Deliveries this month:** deliveries created since 00:00 on the 1st of the current month, in the organization's timezone (`Organization.timezone`, default Asia/Dhaka).

**Rationale.**
- Drivers and vehicles are easy for a buyer to count, and they track company size.
- Monthly deliveries track the value delivered. The limits are generous so that a normal month never hits them, but they stop one plan from carrying a much larger operation.
- Admin seats separate a single-owner shop (Starter) from a team with several dispatchers (Growth and Business).
- Prices are set so Starter costs less than the time one dispatcher saves. Growth targets distributors where customer updates matter. Business sells support and unlimited dispatchers.
- All of these numbers are **hypotheses** (audit §12). Validate them in the first customer interviews before publishing them.

## 3. How enforcement works

- Limits are checked **only when something is added**. The checks run in `assertPlanLimit` (`src/lib/plans.ts`) on these actions:
  - creating a delivery, and CSV import (checked against the whole batch);
  - creating or reactivating a driver;
  - creating or reactivating a vehicle;
  - creating or reactivating an admin.
- The check runs inside the write transaction. It locks the organization row, so two concurrent creates cannot both slip under the limit.
- When a limit would be exceeded, the API returns **403** with a message such as "Your Starter plan allows 5 active drivers (currently 5). Contact FleetFlow to upgrade your plan."
- **Existing data is never removed, hidden or disabled.** A downgrade below current usage, or usage that grew before limits existed, leaves everything working. Only *new* additions of that resource are refused until usage drops below the limit or the plan is raised.
- Editing records, dispatching, status updates, proof of delivery, tracking links and viewing reports are never limited.
- **Limits are live.** Editing a plan's limits applies to every subscriber of that plan immediately (`assertPlanLimit` reads the plan from the database on every check). Existing data is never touched.
- **Impact preview & confirmation.** Before saving a stricter limit, the console calls `POST /api/platform/plans/[code]/preview` to list the subscribers whose current usage would be over it. Saving (`PATCH … { action: "update" }`) refuses with **409 `{ error, impact }`** while a limit that got stricter would put anyone over it; resending with `confirmImpact: true` saves anyway. Those organizations keep everything they have — they just can't add more of that resource until usage drops or the limit is raised. An organization already over a limit that wasn't changed doesn't block unrelated edits.
- The admin sees usage bars per limit in the plan panel (`PlanPanel`). A bar turns amber at 80% of the limit or at the limit itself, and shows a red over-limit state when usage is above it.

## 4. Prices and grandfathering

- A plan's prices are **list prices**. Editing them changes what *new* assignments get, never what existing subscribers pay.
- When a plan is assigned (console `set-plan`, `scripts/set-plan.mjs`, platform "create organization" or self-service sign-up), the organization gets a **price snapshot** in `subscriptionPriceBdt`:
  - a negotiated price if one is entered (whole BDT, ≥ 0);
  - otherwise the plan's list price for the chosen cycle;
  - a plan that is free on both cycles snapshots `null` (free);
  - a paid plan with no price for the chosen cycle can't be assigned on that cycle unless a price is entered (400).
  - Assigning the exact same plan, cycle and price again is refused as a no-op (409).
  - New organizations created from the console or by sign-up start on the **monthly** cycle at the monthly list price.
- An organization whose snapshot differs from the current list price for its cycle is **grandfathered**. The Plans console shows the count per plan, and the organization page shows the agreed price next to the current list price.
- **Apply price to subscribers** is an explicit opt-in per plan and billing cycle. It re-snapshots every subscriber on that plan and cycle to the current list price, writes a platform audit row `PLAN_PRICE_APPLIED` (with the count), and writes a `PLAN_PRICE_UPDATED` row ("Plan price updated by FleetFlow support", old → new price) in each affected company's audit log. Tell those customers before you do this.

### Proposed prices (hypothesis, not validated)

- ৳1,500 / ৳4,000 / ৳9,000 per month for Starter / Growth / Business.
- The UI labels these everywhere as **"Proposed prices in BDT — not final, for discussion"**.
- Optional extras to test in interviews:
  - an annual prepayment discount (for example 2 months free);
  - a one-time onboarding/data-setup fee of ৳5,000–15,000;
  - SMS as a pass-through or a quota, since each message has a real cost.
- No VAT/tax treatment has been decided. Confirm it with an accountant before the first invoice.

## 5. Manual billing process for the first customer

1. **Pilot agreement.** Sign a short written agreement (email confirmation is acceptable for a pilot). It should state:
   - the plan and its limits;
   - the monthly price, or a pilot discount with its end date;
   - the billing period (calendar month);
   - the payment terms (for example, due within 7 days of the invoice);
   - the payment method;
   - support hours;
   - data ownership: the customer owns its data, and FleetFlow exports it on request and never deletes it for non-payment without notice;
   - how either side ends the pilot.
2. **Set the plan.** Either use the organization page in **/platform** (Change plan: plan, billing cycle, optional negotiated price), or the script. Preview first, then apply:
   ```bash
   node scripts/set-plan.mjs --org "<exact org name or id>" --plan growth --dry-run
   node scripts/set-plan.mjs --org "<exact org name or id>" --plan growth
   node scripts/set-plan.mjs --org "<exact org name or id>" --plan growth --cycle annual --price 36000
   ```
   - The script reads plans from the database (the `Plan` table) and applies the same rules as the console: only active plans can be newly assigned, and the snapshot rules of §4 apply (`--cycle monthly|annual`, default monthly; `--price` for a negotiated price).
   - It prints the current plan, cycle and price, the usage, and the new limits. It warns if usage already exceeds the new plan; nothing is deleted.
   - It updates `Organization.plan`, `billingCycle`, `subscriptionPriceBdt` and `planAssignedAt`, and writes one `AuditLog` row: action `PLAN_CHANGED`, actor "FleetFlow billing", with from/to plan, cycle and price plus a usage snapshot in `detail`. The change appears in the customer's audit log. (The console writes the same tenant row with actor "FleetFlow support", plus a platform audit row.)
   - It makes no other writes. It needs `DATABASE_URL` in the environment or in `.env`.
3. **Invoice.** At the start of each month, send a numbered invoice (PDF or email) to `Organization.contactEmail`. Include:
   - the organization name;
   - the plan;
   - the period (month or year, per `billingCycle`);
   - the amount in BDT — the organization's agreed price (`subscriptionPriceBdt`, shown on its /platform page), not today's list price;
   - the payment instructions;
   - the due date.
4. **Payment.** Accept either:
   - bKash, to a merchant or personal number, with the invoice number as the reference; or
   - a bank transfer, with the invoice number as the reference.

   Ask the customer to send the transaction ID.
5. **Record.** Keep a simple ledger (a spreadsheet is fine for now) with one row per invoice:
   - invoice number;
   - organization id and name;
   - plan;
   - period;
   - amount;
   - issue date and due date;
   - paid date;
   - method (bKash or bank);
   - transaction ID / reference;
   - notes.

   Keep a copy of each invoice and payment confirmation.
6. **Plan changes.**
   - **Upgrade:** apply it immediately with the script once agreed, and pro-rate the price or start it next month.
   - **Downgrade:** apply it at the start of the next period.
   - Record every change in the ledger with the date. The `PLAN_CHANGED` audit row is the system record.
7. **Non-payment.** There is no automatic suspension. Follow up by phone. If the account must be paused, agree it with the customer first. Never delete their data.

## 6. Future schema for real subscriptions (proposal only, not implemented)

The manual process above stops scaling once there are a handful of customers. Plans themselves are already in the database (`Plan`), and each organization carries its price snapshot and cycle. The next step is a subscription and invoice history instead of the fields on `Organization`. A sketch:

```prisma
model Subscription {
  id                 String    @id @default(cuid())
  organizationId     String    @unique
  plan               String    // trial | starter | growth | business
  status             String    // TRIALING | ACTIVE | PAST_DUE | PAUSED | CANCELLED
  trialEndsAt        DateTime?
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  cancelAt           DateTime?
  priceBdt           Int       // price agreed for this customer (may differ from list)
  billingEmail       String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
}

model Invoice {
  id             String    @id @default(cuid())
  organizationId String
  number         String    @unique
  periodStart    DateTime
  periodEnd      DateTime
  amountBdt      Int
  status         String    // DRAFT | SENT | PAID | VOID
  paidAt         DateTime?
  method         String?   // BKASH | BANK | ...
  reference      String?   // transaction id
  createdAt      DateTime  @default(now())
}
```

Notes for that migration:
- Backfill one `Subscription` per organization from `Organization.plan`, `billingCycle` and `subscriptionPriceBdt`, and keep those as a cached copy until all readers move over.
- Add enforcement for `trialEndsAt` and `PAST_DUE`. This should be read-only grace, not data deletion.
- A payment gateway (bKash API, SSLCommerz) can then write to `Invoice`.
- Schema changes so far were applied with `prisma db push` plus hand-written SQL in `prisma/manual-migrations/` (e.g. `20261021_plan_management.sql`). Introduce `prisma migrate` before this change.
