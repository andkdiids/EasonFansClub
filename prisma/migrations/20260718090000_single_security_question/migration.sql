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
