-- Unified growth/activity ledger metadata and idempotent completion records.
-- Generated for review only in this change; do not execute automatically.

ALTER TABLE `PointLog`
  MODIFY COLUMN `action` ENUM(
    'POST_CREATE',
    'REPLY_CREATE',
    'DAILY_CHECK_IN',
    'POST_LIKE_RECEIVED',
    'ADMIN_ADJUST',
    'REGISTER',
    'LOGIN',
    'CONTINUOUS_CHECK_IN_BONUS',
    'FEATURED_POST',
    'ACTIVITY_REWARD',
    'BADGE_EXCHANGE',
    'ENTERTAINMENT_DAILY_DRAW',
    'POST_DAILY_FIRST',
    'POST_COMMENT_DAILY',
    'POST_COMMENT_RECEIVED',
    'COMMENT_POST',
    'COMMENT_REVOKE',
    'GUESS_SONG_DUEL_WIN',
    'USER_REWARD',
    'CHECK_IN_MAKEUP',
    'MATERIAL_REDEMPTION',
    'MATERIAL_REDEMPTION_REFUND',
    'ACTIVITY_REGISTRATION_FEE',
    'ACTIVITY_REGISTRATION_REFUND',
    'ACTIVITY_LOTTERY_PRIZE',
    'PHARMACY_DRAW_COST',
    'PHARMACY_PRIZE_REWARD',
    'PHARMACY_DUPLICATE_RECYCLE',
    'GROWTH_REWARD',
    'GROWTH_REWARD_REVERSAL'
  ) NOT NULL,
  ADD COLUMN `growthTaskCode` VARCHAR(64) NULL,
  ADD COLUMN `sourceEventId` VARCHAR(191) NULL,
  ADD COLUMN `reversalOfBusinessKey` VARCHAR(191) NULL,
  ADD INDEX `PointLog_userId_growthTaskCode_createdAt_idx` (`userId`, `growthTaskCode`, `createdAt`),
  ADD INDEX `PointLog_growthTaskCode_sourceEventId_idx` (`growthTaskCode`, `sourceEventId`),
  ADD INDEX `PointLog_reversalOfBusinessKey_idx` (`reversalOfBusinessKey`);

CREATE TABLE `GrowthTaskCompletion` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `taskCode` VARCHAR(64) NOT NULL,
  `periodKey` VARCHAR(32) NOT NULL,
  `sourceEventId` VARCHAR(191) NOT NULL,
  `oneTimeKey` VARCHAR(191) NULL,
  `completedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `claimedAt` DATETIME(3) NULL,
  `rewardAmount` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GrowthTaskCompletion_userId_taskCode_periodKey_sourceEventId_key` (`userId`, `taskCode`, `periodKey`, `sourceEventId`),
  UNIQUE INDEX `GrowthTaskCompletion_oneTimeKey_key` (`oneTimeKey`),
  INDEX `GrowthTaskCompletion_userId_taskCode_completedAt_idx` (`userId`, `taskCode`, `completedAt`),
  INDEX `GrowthTaskCompletion_userId_periodKey_completedAt_idx` (`userId`, `periodKey`, `completedAt`),
  CONSTRAINT `GrowthTaskCompletion_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `GrowthWeeklyMilestoneClaim` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `weekKey` VARCHAR(10) NOT NULL,
  `milestone` INT NOT NULL,
  `rewardAmount` INT NOT NULL,
  `claimedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GrowthWeeklyMilestoneClaim_userId_weekKey_milestone_key` (`userId`, `weekKey`, `milestone`),
  INDEX `GrowthWeeklyMilestoneClaim_userId_weekKey_idx` (`userId`, `weekKey`),
  CONSTRAINT `GrowthWeeklyMilestoneClaim_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
