-- Backfill for 20261021_business_readiness (idempotent, non-destructive)
UPDATE "Notification" n SET "organizationId" = u."organizationId"
  FROM "User" u WHERE n."userId" = u.id AND n."organizationId" IS NULL;
-- Emails recorded before a real provider existed were never sent.
UPDATE "Notification" SET "status" = 'SIMULATED' WHERE "channel" = 'EMAIL' AND "status" IS NULL;
