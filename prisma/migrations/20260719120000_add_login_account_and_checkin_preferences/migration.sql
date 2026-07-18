BEGIN;

-- Never guess how to resolve a login-account conflict. Abort the whole migration
-- unless the JavaScript NFKC/lowercase backfill has completed without collisions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'usernameNormalized'
  ) THEN
    RAISE EXCEPTION 'USERNAME_NORMALIZED_STAGING_COLUMN_REQUIRED';
  END IF;

  IF EXISTS (SELECT 1 FROM "User" WHERE "usernameNormalized" IS NULL OR "usernameNormalized" = '') THEN
    RAISE EXCEPTION 'USERNAME_NORMALIZED_BACKFILL_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "User"
    GROUP BY "usernameNormalized"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'USERNAME_NORMALIZED_CONFLICTS_EXIST';
  END IF;
END $$;

ALTER TABLE "User"
ALTER COLUMN "usernameNormalized" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_usernameNormalized_key"
ON "User"("usernameNormalized");

-- Preserve existing check-in behavior for every historical user.
ALTER TABLE "User"
ADD COLUMN "checkinMoodEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Existing non-null moods are untouched; future mood-free messages are allowed.
ALTER TABLE "DailyMessage"
ALTER COLUMN "mood" DROP NOT NULL;

COMMIT;
