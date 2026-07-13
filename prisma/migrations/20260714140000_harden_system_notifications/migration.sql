DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SystemNotificationType') THEN
    CREATE TYPE "SystemNotificationType" AS ENUM ('SYSTEM', 'UPDATE', 'ANNOUNCEMENT', 'ACTIVITY', 'MAINTENANCE', 'SECURITY');
  END IF;
END $$;

ALTER TABLE "SystemNotification"
  ADD COLUMN IF NOT EXISTS "cover" TEXT,
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "popup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sticky" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publishAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expireAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "published" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "buttonText" TEXT,
  ADD COLUMN IF NOT EXISTS "buttonUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "version" TEXT;

UPDATE "SystemNotification"
SET
  "publishAt" = COALESCE("publishAt", "publishedAt", CURRENT_TIMESTAMP),
  "published" = COALESCE("published", "isPublished", true);

ALTER TABLE "SystemNotification"
  ALTER COLUMN "publishAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "publishAt" SET NOT NULL,
  ALTER COLUMN "published" SET DEFAULT true,
  ALTER COLUMN "published" SET NOT NULL;

ALTER TABLE "SystemNotification" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "SystemNotification"
  ALTER COLUMN "type" TYPE "SystemNotificationType"
  USING CASE
    WHEN "type" IN ('SYSTEM', 'UPDATE', 'ANNOUNCEMENT', 'ACTIVITY', 'MAINTENANCE', 'SECURITY')
      THEN "type"::"SystemNotificationType"
    WHEN "type" = 'ADMIN'
      THEN 'SYSTEM'::"SystemNotificationType"
    ELSE 'SYSTEM'::"SystemNotificationType"
  END;
ALTER TABLE "SystemNotification" ALTER COLUMN "type" SET DEFAULT 'SYSTEM';

CREATE INDEX IF NOT EXISTS "SystemNotification_published_publishAt_idx" ON "SystemNotification"("published", "publishAt");
CREATE INDEX IF NOT EXISTS "SystemNotification_expireAt_idx" ON "SystemNotification"("expireAt");
CREATE INDEX IF NOT EXISTS "SystemNotification_priority_idx" ON "SystemNotification"("priority");
CREATE INDEX IF NOT EXISTS "SystemNotification_type_idx" ON "SystemNotification"("type");
CREATE INDEX IF NOT EXISTS "SystemNotification_sticky_priority_publishAt_idx" ON "SystemNotification"("sticky", "priority", "publishAt");
