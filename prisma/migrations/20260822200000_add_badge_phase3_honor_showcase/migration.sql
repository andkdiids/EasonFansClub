-- E院勋章 Phase 3：荣誉橱窗、授予通知、系列完成奖励与稀有动态。
-- 仅增加新表、新字段和可放宽的规则阈值；不删除 Badge/UserBadge、佩戴关系或历史记录。

ALTER TABLE `Badge`
    ADD COLUMN `announceOnGrant` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `countsTowardSeriesCompletion` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `User`
    ADD COLUMN `showBadgeActivity` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `BadgeSeries`
    ADD COLUMN `completionRewardBadgeId` VARCHAR(191) NULL,
    ADD INDEX `BadgeSeries_completionRewardBadgeId_idx` (`completionRewardBadgeId`),
    ADD CONSTRAINT `BadgeSeries_completionRewardBadgeId_fkey`
      FOREIGN KEY (`completionRewardBadgeId`) REFERENCES `Badge`(`id`)
      ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing structured rules all have thresholds. The nullable column is reserved
-- for BADGE_SERIES_COMPLETE, whose condition is the configured series membership,
-- not an invented numeric threshold.
ALTER TABLE `BadgeRule`
    MODIFY COLUMN `ruleType` ENUM('POST_COUNT', 'FEATURED_POST_COUNT', 'CHECKIN_TOTAL_DAYS', 'CHECKIN_STREAK', 'ACCOUNT_AGE_DAYS', 'FRIEND_COUNT', 'FOLLOWER_COUNT', 'GUESS_SONG_MAX_STREAK', 'DUEL_WIN_COUNT', 'WANT_LISTEN_MAX_STREAK', 'CONCERT_ATTENDANCE_COUNT', 'RATING_COUNT', 'BADGE_SERIES_COMPLETE') NOT NULL,
    MODIFY COLUMN `threshold` INT NULL;

CREATE TABLE `UserBadgeShowcase` (
    `id` VARCHAR(191) NOT NULL,
    `slot` INT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `UserBadgeShowcase_userId_badgeId_key` (`userId`, `badgeId`),
    UNIQUE INDEX `UserBadgeShowcase_userId_slot_key` (`userId`, `slot`),
    INDEX `UserBadgeShowcase_badgeId_idx` (`badgeId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `UserBadgeShowcase_userId_fkey`
      FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `UserBadgeShowcase_badgeId_fkey`
      FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`)
      ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
