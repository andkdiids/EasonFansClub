-- Leaderboard automatic rewards: additive only.
-- Two new PointActionType values for weekly / monthly leaderboard rewards, and
-- five new tables for config, settlement runs (idempotency gate), per-user
-- weekly cap usage, and immutable reward/badge grant audit rows.
-- No existing column changes meaning; no historical data is rewritten.

-- AlterEnum
ALTER TABLE `PointLog` MODIFY `action` ENUM('POST_CREATE', 'REPLY_CREATE', 'DAILY_CHECK_IN', 'POST_LIKE_RECEIVED', 'ADMIN_ADJUST', 'REGISTER', 'LOGIN', 'CONTINUOUS_CHECK_IN_BONUS', 'FEATURED_POST', 'ACTIVITY_REWARD', 'BADGE_EXCHANGE', 'ENTERTAINMENT_DAILY_DRAW', 'POST_DAILY_FIRST', 'POST_COMMENT_DAILY', 'POST_COMMENT_RECEIVED', 'COMMENT_POST', 'COMMENT_REVOKE', 'GUESS_SONG_DUEL_WIN', 'USER_REWARD', 'CHECK_IN_MAKEUP', 'MATERIAL_REDEMPTION', 'MATERIAL_REDEMPTION_REFUND', 'ACTIVITY_REGISTRATION_FEE', 'ACTIVITY_REGISTRATION_REFUND', 'ACTIVITY_LOTTERY_PRIZE', 'PHARMACY_DRAW_COST', 'PHARMACY_PRIZE_REWARD', 'PHARMACY_DUPLICATE_RECYCLE', 'GROWTH_REWARD', 'GROWTH_REWARD_REVERSAL', 'GLOBAL_POINTS_GRANT', 'TOPIC_ACTIVITY_REWARD', 'SHUN_STEAL', 'SHUN_RECOVERY', 'SHUN_COMPENSATION', 'SHUN_BONUS', 'LEADERBOARD_WEEKLY_REWARD', 'LEADERBOARD_MONTHLY_REWARD') NOT NULL;

-- CreateTable
CREATE TABLE `LeaderboardRewardSettings` (
    `id` INTEGER NOT NULL,
    `config` JSON NOT NULL,
    `rulesVersion` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaderboardSettlementRun` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `periodKey` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `configSnapshot` JSON NOT NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    UNIQUE INDEX `LeaderboardSettlementRun_kind_periodKey_key`(`kind`, `periodKey`),
    INDEX `LeaderboardSettlementRun_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaderboardWeeklyCapUsage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `periodKey` VARCHAR(64) NOT NULL,
    `used` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `LeaderboardWeeklyCapUsage_userId_category_periodKey_key`(`userId`, `category`, `periodKey`),
    INDEX `LeaderboardWeeklyCapUsage_category_periodKey_idx`(`category`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaderboardRewardGrant` (
    `id` VARCHAR(191) NOT NULL,
    `businessKey` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `boardKey` VARCHAR(128) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `rank` INTEGER NOT NULL,
    `originalAmount` INTEGER NOT NULL,
    `capUsedBefore` INTEGER NOT NULL,
    `capUsedAfter` INTEGER NOT NULL,
    `actualAmount` INTEGER NOT NULL DEFAULT 0,
    `clippedAmount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `LeaderboardRewardGrant_businessKey_key`(`businessKey`),
    INDEX `LeaderboardRewardGrant_runId_idx`(`runId`),
    INDEX `LeaderboardRewardGrant_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaderboardBadgeGrant` (
    `id` VARCHAR(191) NOT NULL,
    `grantKey` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `badgeKey` VARCHAR(32) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,
    `boardKey` VARCHAR(128) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `rank` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `LeaderboardBadgeGrant_grantKey_key`(`grantKey`),
    INDEX `LeaderboardBadgeGrant_runId_idx`(`runId`),
    INDEX `LeaderboardBadgeGrant_userId_badgeKey_idx`(`userId`, `badgeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
