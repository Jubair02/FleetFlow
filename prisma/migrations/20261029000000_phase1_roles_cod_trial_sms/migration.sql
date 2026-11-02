-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "codAmount" INTEGER,
ADD COLUMN     "codCollectedAmount" INTEGER,
ADD COLUMN     "codCollectedAt" TIMESTAMP(3),
ADD COLUMN     "codCollectedById" TEXT,
ADD COLUMN     "codSettlementId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "recipientPhone" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProofOfDelivery" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "locationAccuracyM" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isOwner" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CodSettlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "deliveryCount" INTEGER NOT NULL,
    "receivedById" TEXT,
    "receivedByName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodSettlement_organizationId_createdAt_idx" ON "CodSettlement"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CodSettlement_driverId_createdAt_idx" ON "CodSettlement"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "Delivery_organizationId_codCollectedById_codSettlementId_idx" ON "Delivery"("organizationId", "codCollectedById", "codSettlementId");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_codCollectedById_fkey" FOREIGN KEY ("codCollectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_codSettlementId_fkey" FOREIGN KEY ("codSettlementId") REFERENCES "CodSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodSettlement" ADD CONSTRAINT "CodSettlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodSettlement" ADD CONSTRAINT "CodSettlement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Backfills (data only; no existing values are overwritten) ──────────────

-- Owner = each company's earliest-created admin (the account that signed up).
UPDATE "User" u SET "isOwner" = true
WHERE u."id" IN (
  SELECT DISTINCT ON ("organizationId") "id" FROM "User"
  WHERE "role" = 'ADMIN'
  ORDER BY "organizationId", "createdAt" ASC, "id" ASC
);

-- Companies on trial get a fresh 14-day trial from today, so nobody is locked out
-- the moment enforcement ships.
UPDATE "Organization" SET "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '14 days'
WHERE "subscriptionStatus" = 'TRIAL' AND "trialEndsAt" IS NULL;
