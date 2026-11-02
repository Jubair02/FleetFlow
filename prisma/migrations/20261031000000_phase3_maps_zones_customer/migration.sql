-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "deliveryFeeBdt" INTEGER,
ADD COLUMN     "deliveryLat" DOUBLE PRECISION,
ADD COLUMN     "deliveryLng" DOUBLE PRECISION,
ADD COLUMN     "feeOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "geoSource" TEXT,
ADD COLUMN     "geocodeAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "plannedEta" TIMESTAMP(3),
ADD COLUMN     "ratedAt" TIMESTAMP(3),
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "ratingComment" TEXT,
ADD COLUMN     "rescheduleNote" TEXT,
ADD COLUMN     "rescheduleRequestedAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleRequestedFor" TIMESTAMP(3),
ADD COLUMN     "rescheduleResolvedAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleStatus" TEXT,
ADD COLUMN     "rescheduleWindow" TEXT,
ADD COLUMN     "routePlannedAt" TIMESTAMP(3),
ADD COLUMN     "routeSeq" INTEGER,
ADD COLUMN     "weightKg" DOUBLE PRECISION,
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "allowCustomerRating" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowCustomerReschedule" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "brandLogoKey" TEXT,
ADD COLUMN     "pickupLat" DOUBLE PRECISION,
ADD COLUMN     "pickupLng" DOUBLE PRECISION,
ADD COLUMN     "trackingMessage" TEXT;

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areas" TEXT[],
    "baseFeeBdt" INTEGER NOT NULL,
    "includedKg" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "perExtraKgBdt" INTEGER NOT NULL DEFAULT 0,
    "codFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "codFeeMinBdt" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverLocation" (
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverLocation_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "DeliveryZone_organizationId_active_sortOrder_idx" ON "DeliveryZone"("organizationId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_organizationId_name_key" ON "DeliveryZone"("organizationId", "name");

-- CreateIndex
CREATE INDEX "DriverLocation_organizationId_recordedAt_idx" ON "DriverLocation"("organizationId", "recordedAt");

-- CreateIndex
CREATE INDEX "Delivery_zoneId_idx" ON "Delivery"("zoneId");

-- CreateIndex
CREATE INDEX "Delivery_organizationId_rescheduleStatus_idx" ON "Delivery"("organizationId", "rescheduleStatus");

-- CreateIndex
CREATE INDEX "Delivery_organizationId_ratedAt_idx" ON "Delivery"("organizationId", "ratedAt");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLocation" ADD CONSTRAINT "DriverLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLocation" ADD CONSTRAINT "DriverLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

