ALTER TABLE `Post`
  ADD COLUMN `lastCommentFloor` INTEGER NOT NULL DEFAULT 0 AFTER `replyCount`;

ALTER TABLE `Reply`
  ADD COLUMN `floorNumber` INTEGER NULL AFTER `parentId`;

-- Backfill every historical top-level reply, including soft-deleted rows, so
-- deleted floors remain holes and the next sequence value never goes back.
UPDATE `Reply` AS target
JOIN (
  SELECT ranked.`id`, ranked.`floorNumber`
  FROM (
    SELECT
      `id`,
      ROW_NUMBER() OVER (
        PARTITION BY `postId`
        ORDER BY `createdAt` ASC, `id` ASC
      ) AS `floorNumber`
    FROM `Reply`
    WHERE `parentId` IS NULL
  ) AS ranked
) AS source ON source.`id` = target.`id`
SET target.`floorNumber` = source.`floorNumber`
WHERE target.`parentId` IS NULL;

UPDATE `Post` AS post
LEFT JOIN (
  SELECT `postId`, MAX(`floorNumber`) AS `lastCommentFloor`
  FROM `Reply`
  WHERE `parentId` IS NULL
  GROUP BY `postId`
) AS floors ON floors.`postId` = post.`id`
SET post.`lastCommentFloor` = COALESCE(floors.`lastCommentFloor`, 0);

CREATE UNIQUE INDEX `Reply_postId_floorNumber_key`
  ON `Reply` (`postId`, `floorNumber`);
