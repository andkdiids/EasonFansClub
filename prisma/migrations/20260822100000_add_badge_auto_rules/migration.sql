-- E院勋章自动授予规则：仅增加结构化规则，不修改既有 Badge/UserBadge 数据。

ALTER TABLE `Badge`
    ADD COLUMN `acquisitionDescriptionCustomized` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `BadgeRule` (
    `id` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,
    `ruleType` ENUM('POST_COUNT', 'FEATURED_POST_COUNT', 'CHECKIN_TOTAL_DAYS', 'CHECKIN_STREAK', 'ACCOUNT_AGE_DAYS', 'FRIEND_COUNT', 'FOLLOWER_COUNT', 'GUESS_SONG_MAX_STREAK', 'DUEL_WIN_COUNT', 'WANT_LISTEN_MAX_STREAK', 'CONCERT_ATTENDANCE_COUNT', 'RATING_COUNT') NOT NULL,
    `operator` ENUM('GTE', 'LTE', 'EQ') NOT NULL DEFAULT 'GTE',
    `threshold` INT NOT NULL,
    `secondaryThreshold` INT NULL,
    `configJson` JSON NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BadgeRule_badgeId_key`(`badgeId`),
    INDEX `BadgeRule_ruleType_isEnabled_idx`(`ruleType`, `isEnabled`),
    PRIMARY KEY (`id`),
    CONSTRAINT `BadgeRule_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
