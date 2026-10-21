# FleetFlow billing — minimal subscription model

FleetFlow has **no payment gateway**. Plans are stored on the organization and changed by hand.
The prices are a **proposed hypothesis** that customer interviews have not yet tested.
This document describes the model, how limits are enforced, and the manual process for the first paying customer.

Code references:
- `src/lib/plan-catalog.ts` holds the plan catalog (client-safe).
- `src/lib/plans.ts` holds usage counting and limit enforcement (server only).
- `GET /api/billing` returns the plan and usage for admins.
- `scripts/set-plan.mjs` changes a plan.

---

## 1. The model

- Each organization has exactly one plan: `Organization.plan`, one of `trial | starter | growth | business`. An unknown value falls back to `trial`.
- A plan is a **monthly subscription with resource limits**. There are no per-seat charges and no metered billing.
- **Trial** is free. It has Growth-like limits so a prospect can evaluate with real data. It has no automatic end date, because there is no subscription table yet (see §6).
- The billing contact is `Organization.contactEmail`, which the admin edits in organization settings.

## 2. Plans and limits

| Plan | Proposed price / month | Active drivers | Vehicles in service | Admin/dispatcher accounts | Deliveries / month |
|---|---|---|---|---|---|
| Trial | free | 10 | 10 | 3 | 1,000 |
| Starter | ৳1,500 | 5 | 5 | 1 | 500 |
| Growth | ৳4,000 | 20 | 20 | 3 | 3,000 |
| Business | ৳9,000 | 50 | 50 | unlimited | 15,000 |

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
- Editing records, dispatching, status updates, proof of delivery, tracking links and reports are never limited.
- The admin sees usage bars per limit in the plan panel (`PlanPanel`). A bar turns amber at 80% of the limit or at the limit itself, and shows a red over-limit state when usage is above it.

## 4. Proposed prices (hypothesis, not validated)

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
2. **Set the plan.** Preview the change first, then apply it:
   ```bash
   node scripts/set-plan.mjs --org "<exact org name or id>" --plan growth --dry-run
   node scripts/set-plan.mjs --org "<exact org name or id>" --plan growth
   ```
   - The script prints the current plan, the usage, and the new limits. It warns if usage already exceeds the new plan; nothing is deleted.
   - It updates `Organization.plan` and writes one `AuditLog` row: action `PLAN_CHANGED`, actor "FleetFlow billing", with from/to plan and a usage snapshot in `detail`. The change appears in the customer's audit log.
   - It makes no other writes. It needs `DATABASE_URL` in the environment or in `.env`.
3. **Invoice.** At the start of each month, send a numbered invoice (PDF or email) to `Organization.contactEmail`. Include:
   - the organization name;
   - the plan;
   - the period;
   - the amount in BDT;
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

The manual process above stops scaling once there are a handful of customers. When that happens, add a subscription record instead of overloading `Organization.plan`. A sketch:

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
- Backfill one `Subscription` per organization from `Organization.plan`, and keep `Organization.plan` as a cached copy until all readers move over.
- Add enforcement for `trialEndsAt` and `PAST_DUE`. This should be read-only grace, not data deletion.
- A payment gateway (bKash API, SSLCommerz) can then write to `Invoice`.
- The project has no migration history yet (`prisma db push`). Introduce `prisma migrate` before this change.
