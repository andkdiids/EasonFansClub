-- 指定活动报名自动兑换活动物料，并保留普通活动/物料兑换规则不变。
-- 本文件只生成增量 migration；本轮不执行 migrate、db push 或生产数据库写操作。

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
    'ACTIVITY_REGISTRATION_REFUND'
  ) NOT NULL;

ALTER TABLE `MaterialRedemptionRule`
  MODIFY COLUMN `type` ENUM(
    'NONE',
    'ACTIVITY_REGISTRATION_REQUIRED',
    'REGISTER_DAYS',
    'CHECKIN_TOTAL',
    'CHECKIN_STREAK',
    'HAS_BADGE',
    'ATTENDED_CONCERT',
    'SPECIFIC_USER'
  ) NOT NULL;

ALTER TABLE `Activity`
  ADD COLUMN `registrationFee` INT NOT NULL DEFAULT 0,
  ADD COLUMN `feeDescription` TEXT NULL;

ALTER TABLE `MaterialRedemption`
  ADD COLUMN `redemptionRule` ENUM('DEFAULT', 'ACTIVITY_REGISTRATION_REQUIRED') NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN `linkedActivityId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `MaterialRedemption_linkedActivityId_key` (`linkedActivityId`),
  ADD CONSTRAINT `MaterialRedemption_linkedActivityId_fkey`
    FOREIGN KEY (`linkedActivityId`) REFERENCES `Activity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ActivityRegistration`
  ADD COLUMN `paidRegistrationFee` INT NOT NULL DEFAULT 0,
  ADD COLUMN `checkInSource` ENUM('MANUAL', 'QR', 'AUTO_AFTER_ACTIVITY_END') NULL,
  ADD COLUMN `linkedMaterialRedemptionId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `ActivityRegistration_linkedMaterialRedemptionId_key` (`linkedMaterialRedemptionId`),
  ADD INDEX `ActivityRegistration_checkInSource_verifiedAt_idx` (`checkInSource`, `verifiedAt`);

ALTER TABLE `MaterialRedemptionOrder`
  ADD COLUMN `source` ENUM('MANUAL', 'ACTIVITY_REGISTRATION_AUTO') NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN `linkedActivityId` VARCHAR(191) NULL,
  ADD COLUMN `redemptionSource` ENUM('MANUAL', 'ACTIVITY_CHECK_IN', 'ACTIVITY_AUTO_CHECK_IN') NULL,
  ADD INDEX `MaterialRedemptionOrder_linkedActivityId_createdAt_idx` (`linkedActivityId`, `createdAt`),
  ADD INDEX `MaterialRedemptionOrder_source_status_idx` (`source`, `status`),
  ADD CONSTRAINT `MaterialRedemptionOrder_linkedActivityId_fkey`
    FOREIGN KEY (`linkedActivityId`) REFERENCES `Activity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ActivityRegistration`
  ADD CONSTRAINT `ActivityRegistration_linkedMaterialRedemptionId_fkey`
    FOREIGN KEY (`linkedMaterialRedemptionId`) REFERENCES `MaterialRedemptionOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PointLog`
  ADD COLUMN `activityRegistrationId` VARCHAR(191) NULL,
  ADD INDEX `PointLog_activityRegistrationId_idx` (`activityRegistrationId`),
  ADD CONSTRAINT `PointLog_activityRegistrationId_fkey`
    FOREIGN KEY (`activityRegistrationId`) REFERENCES `ActivityRegistration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
