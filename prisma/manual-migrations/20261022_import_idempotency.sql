-- 2026-10-22 paste import: idempotency key + source on ImportBatch (additive)
-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'CSV';

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_organizationId_idempotencyKey_key" ON "ImportBatch"("organizationId", "idempotencyKey");

