-- Add request idempotency for feedback creation.
ALTER TABLE "Feedback" ADD COLUMN "idempotencyKeyHash" TEXT;
CREATE UNIQUE INDEX "Feedback_idempotencyKeyHash_key" ON "Feedback"("idempotencyKeyHash");

-- Normalize each check-in to one Asia/Shanghai calendar date.
ALTER TABLE "CheckIn" ADD COLUMN "checkinDateKey" TEXT;
UPDATE "CheckIn"
SET "checkinDateKey" = to_char("checkDate" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
WHERE "checkinDateKey" IS NULL;

CREATE TEMP TABLE "_CheckInDedup" ON COMMIT DROP AS
SELECT "id" AS "duplicateId", "keeperId"
FROM (
  SELECT
    c."id",
    first_value(c."id") OVER (
      PARTITION BY c."userId", c."checkinDateKey"
      ORDER BY (c."message" IS NOT NULL) DESC, c."createdAt" ASC, c."id" ASC
    ) AS "keeperId",
    row_number() OVER (
      PARTITION BY c."userId", c."checkinDateKey"
      ORDER BY (c."message" IS NOT NULL) DESC, c."createdAt" ASC, c."id" ASC
    ) AS "rowNumber"
  FROM "CheckIn" c
) ranked
WHERE "rowNumber" > 1;

-- Preserve legal messages; only detach their duplicate check-in relation.
UPDATE "DailyMessage" message
SET "checkInId" = NULL
FROM "_CheckInDedup" duplicate
WHERE message."checkInId" = duplicate."duplicateId";

UPDATE "FriendActivity" activity
SET "checkInId" = duplicate."keeperId"
FROM "_CheckInDedup" duplicate
WHERE activity."checkInId" = duplicate."duplicateId";

UPDATE "PointLog" log
SET "checkInId" = duplicate."keeperId"
FROM "_CheckInDedup" duplicate
WHERE log."checkInId" = duplicate."duplicateId";

WITH duplicate_logs AS (
  SELECT "id"
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "action", "checkInId" ORDER BY "createdAt", "id") AS rn
    FROM "PointLog"
    WHERE "checkInId" IS NOT NULL
  ) ranked
  WHERE rn > 1
)
UPDATE "PointLog" SET "checkInId" = NULL WHERE "id" IN (SELECT "id" FROM duplicate_logs);

DELETE FROM "CheckIn" checkin
USING "_CheckInDedup" duplicate
WHERE checkin."id" = duplicate."duplicateId";

ALTER TABLE "CheckIn" ALTER COLUMN "checkinDateKey" SET NOT NULL;
CREATE UNIQUE INDEX "CheckIn_userId_checkinDateKey_key" ON "CheckIn"("userId", "checkinDateKey");

-- Bind future rewards to a single business source.
ALTER TABLE "ExperienceLog" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "ExperienceLog" ADD COLUMN "sourceId" TEXT;
CREATE UNIQUE INDEX "ExperienceLog_sourceType_sourceId_key" ON "ExperienceLog"("sourceType", "sourceId");
CREATE UNIQUE INDEX "PointLog_action_checkInId_key" ON "PointLog"("action", "checkInId");
