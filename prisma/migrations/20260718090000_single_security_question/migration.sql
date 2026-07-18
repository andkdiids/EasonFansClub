BEGIN;

-- Block concurrent writes until backup, cleanup, and index replacement finish.
LOCK TABLE "UserSecurityQuestion" IN SHARE ROW EXCLUSIVE MODE;

-- Full pre-cleanup snapshot for rollback and audit. The backup table is
-- intentionally not part of the Prisma schema.
CREATE TABLE "UserSecurityQuestion_backup_20260718" AS
TABLE "UserSecurityQuestion";

-- Record the total rows, affected users, and rows that will be removed.
DO $$
DECLARE
  total_question_count BIGINT;
  multi_question_user_count BIGINT;
  delete_question_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO total_question_count
  FROM "UserSecurityQuestion";

  SELECT COUNT(*) INTO multi_question_user_count
  FROM (
    SELECT "userId"
    FROM "UserSecurityQuestion"
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) AS users_with_multiple_questions;

  SELECT COALESCE(SUM(question_count - 1), 0) INTO delete_question_count
  FROM (
    SELECT COUNT(*) AS question_count
    FROM "UserSecurityQuestion"
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) AS duplicate_questions;

  RAISE NOTICE 'UserSecurityQuestion migration: total=%, multi_question_users=%, rows_to_delete=%',
    total_question_count, multi_question_user_count, delete_question_count;
END $$;

-- Keep the first configured security question for every user.
WITH ranked_questions AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "userId"
    ORDER BY "sortOrder" ASC, "createdAt" ASC, "id" ASC
  ) AS row_number
  FROM "UserSecurityQuestion"
)
DELETE FROM "UserSecurityQuestion"
WHERE "id" IN (
  SELECT "id" FROM ranked_questions WHERE row_number > 1
);

DROP INDEX IF EXISTS "UserSecurityQuestion_userId_sortOrder_key";
CREATE UNIQUE INDEX "UserSecurityQuestion_userId_key"
  ON "UserSecurityQuestion"("userId");

COMMIT;
