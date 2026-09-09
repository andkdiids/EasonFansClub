-- Reply text and its friend-activity snapshot both accept the product's
-- 300 user-perceived-character limit, including utf8mb4 text.
ALTER TABLE `Reply`
  MODIFY COLUMN `content` TEXT NOT NULL;

ALTER TABLE `FriendActivity`
  MODIFY COLUMN `content` TEXT NULL;
