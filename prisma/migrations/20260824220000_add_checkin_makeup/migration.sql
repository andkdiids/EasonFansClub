-- 补挂号：扩展现有 CheckIn，保留所有历史签到、余额和奖励数据。
ALTER TABLE `CheckIn`
  ADD COLUMN `type` ENUM('NORMAL','MAKEUP_FREE_QUIZ','MAKEUP_PAID','MAKEUP_ADMIN') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `madeUpAt` DATETIME(3) NULL,
  ADD COLUMN `makeupCost` INTEGER NULL,
  ADD COLUMN `challengeId` VARCHAR(191) NULL;

CREATE TABLE `MakeupChallenge` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `targetDate` DATETIME(3) NOT NULL,
  `targetDateKey` VARCHAR(191) NOT NULL,
  `monthKey` VARCHAR(191) NOT NULL,
  `questionId` VARCHAR(191) NOT NULL,
  `correctOptionId` VARCHAR(191) NOT NULL,
  `options` JSON NOT NULL,
  `audioStoragePath` VARCHAR(191) NOT NULL,
  `playbackSeconds` INTEGER NOT NULL DEFAULT 10,
  `status` ENUM('PENDING','CORRECT','WRONG') NOT NULL DEFAULT 'PENDING',
  `selectedOptionId` VARCHAR(191) NULL,
  `answeredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `MakeupChallenge_userId_monthKey_key` (`userId`, `monthKey`),
  INDEX `MakeupChallenge_userId_status_idx` (`userId`, `status`),
  INDEX `MakeupChallenge_targetDateKey_idx` (`targetDateKey`),
  INDEX `MakeupChallenge_questionId_idx` (`questionId`),
  CONSTRAINT `MakeupChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MakeupChallenge_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `GuessSongQuestion` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `CheckIn_challengeId_key` ON `CheckIn`(`challengeId`);
CREATE INDEX `CheckIn_userId_type_checkinDateKey_idx` ON `CheckIn`(`userId`, `type`, `checkinDateKey`);
ALTER TABLE `CheckIn` ADD CONSTRAINT `CheckIn_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `MakeupChallenge`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PointLog` MODIFY `action` ENUM(
  'POST_CREATE','REPLY_CREATE','DAILY_CHECK_IN','POST_LIKE_RECEIVED','ADMIN_ADJUST','REGISTER','LOGIN',
  'CONTINUOUS_CHECK_IN_BONUS','FEATURED_POST','ACTIVITY_REWARD','BADGE_EXCHANGE','ENTERTAINMENT_DAILY_DRAW',
  'POST_DAILY_FIRST','POST_COMMENT_DAILY','POST_COMMENT_RECEIVED','COMMENT_POST','COMMENT_REVOKE',
  'GUESS_SONG_DUEL_WIN','USER_REWARD','CHECK_IN_MAKEUP'
) NOT NULL;
