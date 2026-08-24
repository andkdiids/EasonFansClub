-- “还有什么可以送给你”限时物料兑换系统。
-- 仅新增枚举值、表和索引；不改写既有业务数据。

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
    'MATERIAL_REDEMPTION_REFUND'
  ) NOT NULL;

CREATE TABLE `MaterialRedemption` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NOT NULL,
  `coverImageUrl` TEXT NULL,
  `instructions` TEXT NULL,
  `cost` INT NOT NULL DEFAULT 0,
  `stockTotal` INT NOT NULL,
  `stockRemaining` INT NOT NULL,
  `perUserLimit` INT NOT NULL DEFAULT 1,
  `exchangeStartAt` DATETIME(3) NOT NULL,
  `exchangeEndAt` DATETIME(3) NOT NULL,
  `redeemEndAt` DATETIME(3) NOT NULL,
  `status` ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'ENDED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  `createdByAdminId` VARCHAR(191) NOT NULL,
  `publishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `MaterialRedemption_status_exchangeStartAt_exchangeEndAt_idx` (`status`, `exchangeStartAt`, `exchangeEndAt`),
  INDEX `MaterialRedemption_createdByAdminId_createdAt_idx` (`createdByAdminId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MaterialRedemption_createdByAdminId_fkey`
    FOREIGN KEY (`createdByAdminId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MaterialRedemptionRule` (
  `id` VARCHAR(191) NOT NULL,
  `materialId` VARCHAR(191) NOT NULL,
  `type` ENUM('NONE', 'REGISTER_DAYS', 'CHECKIN_TOTAL', 'CHECKIN_STREAK', 'HAS_BADGE', 'ATTENDED_CONCERT', 'SPECIFIC_USER') NOT NULL,
  `operator` ENUM('GTE', 'EQ', 'LTE') NOT NULL DEFAULT 'GTE',
  `value` VARCHAR(191) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `MaterialRedemptionRule_materialId_sortOrder_idx` (`materialId`, `sortOrder`),
  INDEX `MaterialRedemptionRule_type_idx` (`type`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MaterialRedemptionRule_materialId_fkey`
    FOREIGN KEY (`materialId`) REFERENCES `MaterialRedemption`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MaterialRedemptionOrder` (
  `id` VARCHAR(191) NOT NULL,
  `materialId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `unitCost` INT NOT NULL,
  `totalCost` INT NOT NULL,
  `status` ENUM('SUCCESS', 'REDEEMED', 'CANCELLED', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'SUCCESS',
  `redeemCode` VARCHAR(64) NOT NULL,
  `redeemToken` VARCHAR(128) NOT NULL,
  `eligibilitySnapshot` JSON NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `redeemedAt` DATETIME(3) NULL,
  `redeemedByAdminId` VARCHAR(191) NULL,
  `expiredAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancelledByAdminId` VARCHAR(191) NULL,
  `refundedAt` DATETIME(3) NULL,
  `refundedByAdminId` VARCHAR(191) NULL,
  `refundReason` VARCHAR(500) NULL,
  UNIQUE INDEX `MaterialRedemptionOrder_redeemCode_key` (`redeemCode`),
  UNIQUE INDEX `MaterialRedemptionOrder_redeemToken_key` (`redeemToken`),
  UNIQUE INDEX `MaterialRedemptionOrder_idempotencyKey_key` (`idempotencyKey`),
  INDEX `MaterialRedemptionOrder_materialId_createdAt_idx` (`materialId`, `createdAt`),
  INDEX `MaterialRedemptionOrder_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `MaterialRedemptionOrder_status_createdAt_idx` (`status`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MaterialRedemptionOrder_materialId_fkey`
    FOREIGN KEY (`materialId`) REFERENCES `MaterialRedemption`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `MaterialRedemptionOrder_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MaterialRedemptionOrder_redeemedByAdminId_fkey`
    FOREIGN KEY (`redeemedByAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `MaterialRedemptionOrder_cancelledByAdminId_fkey`
    FOREIGN KEY (`cancelledByAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `MaterialRedemptionOrder_refundedByAdminId_fkey`
    FOREIGN KEY (`refundedByAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
