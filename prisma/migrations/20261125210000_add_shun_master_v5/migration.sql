-- Shun Master V5: capture counter letter, capture-result notification
-- state machine, recovery bonus bookkeeping and three cumulative badge
-- rule types. Additive only: no existing column changes meaning, no data
-- rewrite, and every new column has a default that keeps historical rows
-- on their current behaviour.

-- AlterEnum
ALTER TABLE `BadgeRule` MODIFY `ruleType` ENUM('POST_COUNT', 'FEATURED_POST_COUNT', 'CHECKIN_TOTAL_DAYS', 'CHECKIN_STREAK', 'ACCOUNT_AGE_DAYS', 'FRIEND_COUNT', 'FOLLOWER_COUNT', 'GUESS_SONG_MAX_STREAK', 'DUEL_WIN_COUNT', 'WANT_LISTEN_MAX_STREAK', 'CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED', 'RATING_COUNT', 'BADGE_SERIES_COMPLETE', 'ACTIVITY_PARTICIPATION', 'TOPIC_ACTIVITY_PARTICIPATION_COUNT', 'BIRTHDAY_ZODIAC', 'BIRTHDAY_TODAY', 'CHECKIN_ON_DATE', 'BADGE_OWNERSHIP', 'CLINIC_CONSULTATION_STREAK', 'SHUN_STOLEN_TOTAL', 'SHUN_VICTIM_TOTAL', 'SHUN_RECOVERED_TOTAL') NOT NULL;

-- AlterEnum
ALTER TABLE `PointLog` MODIFY `action` ENUM('POST_CREATE', 'REPLY_CREATE', 'DAILY_CHECK_IN', 'POST_LIKE_RECEIVED', 'ADMIN_ADJUST', 'REGISTER', 'LOGIN', 'CONTINUOUS_CHECK_IN_BONUS', 'FEATURED_POST', 'ACTIVITY_REWARD', 'BADGE_EXCHANGE', 'ENTERTAINMENT_DAILY_DRAW', 'POST_DAILY_FIRST', 'POST_COMMENT_DAILY', 'POST_COMMENT_RECEIVED', 'COMMENT_POST', 'COMMENT_REVOKE', 'GUESS_SONG_DUEL_WIN', 'USER_REWARD', 'CHECK_IN_MAKEUP', 'MATERIAL_REDEMPTION', 'MATERIAL_REDEMPTION_REFUND', 'ACTIVITY_REGISTRATION_FEE', 'ACTIVITY_REGISTRATION_REFUND', 'ACTIVITY_LOTTERY_PRIZE', 'PHARMACY_DRAW_COST', 'PHARMACY_PRIZE_REWARD', 'PHARMACY_DUPLICATE_RECYCLE', 'GROWTH_REWARD', 'GROWTH_REWARD_REVERSAL', 'GLOBAL_POINTS_GRANT', 'TOPIC_ACTIVITY_REWARD', 'SHUN_STEAL', 'SHUN_RECOVERY', 'SHUN_COMPENSATION', 'SHUN_BONUS') NOT NULL;

-- AlterTable
ALTER TABLE `ShunMasterRound` ADD COLUMN `bonusAwarded` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `bonusRolled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `captureNotifiedAt` DATETIME(3) NULL,
    ADD COLUMN `captureNotifyAuto` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `captureNotifyDueAt` DATETIME(3) NULL,
    ADD COLUMN `captureNotifyStatus` VARCHAR(16) NOT NULL DEFAULT 'SENT_PLAIN';

-- CreateTable
CREATE TABLE `ShunMasterCaptureLetter` (
    `id` VARCHAR(191) NOT NULL,
    `roundId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,
    `hiddenAt` DATETIME(3) NULL,
    `hiddenById` VARCHAR(191) NULL,

    UNIQUE INDEX `ShunMasterCaptureLetter_roundId_key`(`roundId`),
    INDEX `ShunMasterCaptureLetter_recipientId_createdAt_idx`(`recipientId`, `createdAt`),
    INDEX `ShunMasterCaptureLetter_senderId_createdAt_idx`(`senderId`, `createdAt`),
    INDEX `ShunMasterCaptureLetter_hiddenAt_idx`(`hiddenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ShunMasterRound_captureNotifyStatus_captureNotifyDueAt_idx` ON `ShunMasterRound`(`captureNotifyStatus`, `captureNotifyDueAt`);
