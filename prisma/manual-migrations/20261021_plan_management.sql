-- 2026-10-21 plan management. Additive and idempotent (safe to re-run):
-- creates Plan, seeds it from the former code catalog, snapshots existing
-- subscribers' prices, then links Organization.plan → Plan.code.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "planAssignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "subscriptionPriceBdt" INTEGER;

CREATE TABLE IF NOT EXISTS "Plan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPriceBdt" INTEGER,
    "annualPriceBdt" INTEGER,
    "maxDrivers" INTEGER,
    "maxVehicles" INTEGER,
    "maxAdmins" INTEGER,
    "maxMonthlyDeliveries" INTEGER,
    "features" TEXT[],
    "highlights" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

-- Seed from the former catalog. Annual = 10× monthly is a placeholder hypothesis.
INSERT INTO "Plan" ("code","name","description","monthlyPriceBdt","annualPriceBdt","maxDrivers","maxVehicles","maxAdmins","maxMonthlyDeliveries","features","highlights","active","isPublic","isDefault","sortOrder","updatedAt") VALUES
 ('trial','Trial','Free evaluation with Growth-level features',NULL,NULL,10,10,3,1000,ARRAY['csv_import','report_export','customer_emails'],ARRAY['Everything in Growth while you evaluate','Manual upgrade when you''re ready'],true,false,true,0,CURRENT_TIMESTAMP),
 ('starter','Starter','For small teams starting with digital dispatch',1500,15000,5,5,1,500,ARRAY['customer_emails'],ARRAY['Dispatch, driver app & proof of delivery','Customer tracking links','Email notifications'],true,true,false,1,CURRENT_TIMESTAMP),
 ('growth','Growth','For distributors with a growing fleet',4000,40000,20,20,3,3000,ARRAY['csv_import','report_export','customer_emails'],ARRAY['Everything in Starter','CSV delivery import','Performance reports & CSV export'],true,true,false,2,CURRENT_TIMESTAMP),
 ('business','Business','For multi-dispatcher operations',9000,90000,50,50,NULL,15000,ARRAY['csv_import','report_export','customer_emails'],ARRAY['Everything in Growth','Unlimited dispatchers','Priority support & onboarding help'],true,true,false,3,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS "Plan_single_default" ON "Plan" ("isDefault") WHERE "isDefault";

-- Normalize legacy codes; unknown codes → trial (matches the old runtime fallback).
UPDATE "Organization" SET "plan" = lower("plan") WHERE "plan" <> lower("plan");
UPDATE "Organization" SET "plan" = 'trial' WHERE "plan" NOT IN (SELECT "code" FROM "Plan");

-- Grandfather existing subscribers at today's list price (only rows not yet snapshotted).
UPDATE "Organization" o SET "subscriptionPriceBdt" = p."monthlyPriceBdt", "planAssignedAt" = o."createdAt"
  FROM "Plan" p WHERE p."code" = o."plan" AND o."subscriptionPriceBdt" IS NULL AND p."monthlyPriceBdt" IS NOT NULL;

-- Free-plan rows: assignment date = creation date (first run only — the column was just added).
UPDATE "Organization" SET "planAssignedAt" = "createdAt"
  WHERE "subscriptionPriceBdt" IS NULL AND "planAssignedAt" > "createdAt"
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Organization_plan_fkey');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Organization_plan_fkey') THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_plan_fkey"
      FOREIGN KEY ("plan") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
