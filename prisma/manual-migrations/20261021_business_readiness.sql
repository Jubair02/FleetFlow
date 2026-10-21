-- 2026-10-21 business-readiness upgrade (additive only; applied with prisma db execute)
-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "recipientEmail" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "defaultPickupAddress" TEXT,
ADD COLUMN     "onboardingDismissedAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_organizationId_createdAt_idx" ON "ImportBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_organizationId_fileHash_key" ON "ImportBatch"("organizationId", "fileHash");

-- CreateIndex
CREATE INDEX "Delivery_organizationId_externalRef_idx" ON "Delivery"("organizationId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_organizationId_channel_createdAt_idx" ON "Notification"("organizationId", "channel", "createdAt");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

