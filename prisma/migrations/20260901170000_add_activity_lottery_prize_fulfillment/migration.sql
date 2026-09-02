-- Add explicit activity-lottery prize semantics while preserving the legacy
-- LotteryPrize.type column for backwards-compatible reads.
ALTER TABLE `LotteryPrize`
  ADD COLUMN `prizeType` ENUM('PHYSICAL', 'VIRTUAL') NOT NULL DEFAULT 'PHYSICAL',
  ADD COLUMN `virtualPrizeType` ENUM('BADGE', 'REGISTRATION_FEE') NULL,
  ADD COLUMN `badgeId` VARCHAR(191) NULL,
  ADD COLUMN `registrationFeeAmount` INTEGER NULL,
  ADD INDEX `LotteryPrize_badgeId_idx` (`badgeId`);

ALTER TABLE `LotteryEntry`
  ADD COLUMN `fulfillmentStatus` ENUM('NOT_REQUIRED', 'PENDING', 'FULFILLED', 'FAILED') NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN `fulfilledAt` DATETIME(3) NULL,
  ADD COLUMN `fulfillmentError` VARCHAR(500) NULL,
  ADD INDEX `LotteryEntry_lotteryId_fulfillmentStatus_idx` (`lotteryId`, `fulfillmentStatus`);

ALTER TABLE `LotteryPrize`
  ADD CONSTRAINT `LotteryPrize_badgeId_fkey`
  FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

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
    'ACTIVITY_LOTTERY_PRIZE'
  ) NOT NULL;
