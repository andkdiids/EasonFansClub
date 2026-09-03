-- Angel's Gift is a reusable pharmacy module. This migration is additive;
-- apply it only through the normal deployment migration process.

CREATE TABLE `PharmacyCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(300) NULL,
    `description` TEXT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED') NOT NULL DEFAULT 'DRAFT',
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `drawCost` INTEGER NOT NULL,
    `duplicateRecycleEnabled` BOOLEAN NOT NULL DEFAULT false,
    `duplicateRecycleRequired` INTEGER NULL,
    `duplicateRecycleReward` INTEGER NULL,
    `recycleAfterEndEnabled` BOOLEAN NOT NULL DEFAULT true,
    `probabilityPublic` BOOLEAN NOT NULL DEFAULT false,
    `dailyDrawLimit` INTEGER NULL,
    `totalDrawLimit` INTEGER NULL,
    `visualUrl` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `PharmacyCampaign_status_startsAt_endsAt_idx`(`status`, `startsAt`, `endsAt`),
    INDEX `PharmacyCampaign_createdAt_idx`(`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PharmacyPrize` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `type` ENUM('BADGE', 'POINTS', 'EMPTY', 'ITEM', 'COUPON', 'CUSTOM') NOT NULL DEFAULT 'BADGE',
    `name` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `rewardAmount` INTEGER NULL,
    `weight` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `badgeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `PharmacyPrize_campaignId_enabled_sortOrder_idx`(`campaignId`, `enabled`, `sortOrder`),
    INDEX `PharmacyPrize_badgeId_idx`(`badgeId`),
    INDEX `PharmacyPrize_campaignId_type_idx`(`campaignId`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PharmacyDraw` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `prizeId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `drawAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `campaignTitle` VARCHAR(191) NOT NULL,
    `drawCost` INTEGER NOT NULL,
    `prizeType` ENUM('BADGE', 'POINTS', 'EMPTY', 'ITEM', 'COUPON', 'CUSTOM') NOT NULL,
    `prizeName` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NULL,
    `badgeName` VARCHAR(191) NULL,
    `badgeIconUrl` TEXT NULL,
    `rarity` ENUM('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'LIMITED') NULL,
    `rewardAmount` INTEGER NULL,
    `configuredWeight` INTEGER NOT NULL,
    `calculatedProbability` DECIMAL(10, 6) NOT NULL,
    `resultType` ENUM('BADGE_NEW', 'BADGE_DUPLICATE', 'POINTS_REWARD', 'EMPTY', 'ITEM', 'COUPON', 'CUSTOM') NOT NULL,
    `isNewBadge` BOOLEAN NOT NULL DEFAULT false,
    `isDuplicate` BOOLEAN NOT NULL DEFAULT false,
    `duplicateQuantity` INTEGER NOT NULL DEFAULT 0,
    `balanceBefore` INTEGER NOT NULL,
    `balanceAfter` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `PharmacyDraw_userId_idempotencyKey_key`(`userId`, `idempotencyKey`),
    INDEX `PharmacyDraw_campaignId_drawAt_idx`(`campaignId`, `drawAt`),
    INDEX `PharmacyDraw_userId_campaignId_drawAt_idx`(`userId`, `campaignId`, `drawAt`),
    INDEX `PharmacyDraw_prizeId_drawAt_idx`(`prizeId`, `drawAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PharmacyDuplicateInventory` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `sourceBadgeId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `PharmacyDuplicateInventory_userId_campaignId_sourceBadgeId_key`(`userId`, `campaignId`, `sourceBadgeId`),
    INDEX `PharmacyDuplicateInventory_userId_campaignId_idx`(`userId`, `campaignId`),
    INDEX `PharmacyDuplicateInventory_sourceBadgeId_idx`(`sourceBadgeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PharmacyRecycleLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `campaignTitle` VARCHAR(191) NOT NULL,
    `requiredCount` INTEGER NOT NULL,
    `rewardAmount` INTEGER NOT NULL,
    `beforeQuantity` INTEGER NOT NULL,
    `afterQuantity` INTEGER NOT NULL,
    `balanceBefore` INTEGER NOT NULL,
    `balanceAfter` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `PharmacyRecycleLog_userId_idempotencyKey_key`(`userId`, `idempotencyKey`),
    INDEX `PharmacyRecycleLog_campaignId_createdAt_idx`(`campaignId`, `createdAt`),
    INDEX `PharmacyRecycleLog_userId_campaignId_createdAt_idx`(`userId`, `campaignId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PharmacyCampaign`
    ADD CONSTRAINT `PharmacyCampaign_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `PharmacyCampaign_updatedById_fkey`
    FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PharmacyPrize`
    ADD CONSTRAINT `PharmacyPrize_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `PharmacyCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `PharmacyPrize_badgeId_fkey`
    FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PharmacyDraw`
    ADD CONSTRAINT `PharmacyDraw_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `PharmacyDraw_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `PharmacyCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `PharmacyDraw_prizeId_fkey`
    FOREIGN KEY (`prizeId`) REFERENCES `PharmacyPrize`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PharmacyDuplicateInventory`
    ADD CONSTRAINT `PharmacyDuplicateInventory_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `PharmacyDuplicateInventory_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `PharmacyCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `PharmacyDuplicateInventory_sourceBadgeId_fkey`
    FOREIGN KEY (`sourceBadgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PharmacyRecycleLog`
    ADD CONSTRAINT `PharmacyRecycleLog_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `PharmacyRecycleLog_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `PharmacyCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PointLog`
    ADD COLUMN `pharmacyDrawId` VARCHAR(191) NULL,
    ADD COLUMN `pharmacyRecycleLogId` VARCHAR(191) NULL,
    ADD INDEX `PointLog_pharmacyDrawId_idx`(`pharmacyDrawId`),
    ADD INDEX `PointLog_pharmacyRecycleLogId_idx`(`pharmacyRecycleLogId`),
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
      'PHARMACY_DUPLICATE_RECYCLE'
    ) NOT NULL,
    ADD CONSTRAINT `PointLog_pharmacyDrawId_fkey`
    FOREIGN KEY (`pharmacyDrawId`) REFERENCES `PharmacyDraw`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `PointLog_pharmacyRecycleLogId_fkey`
    FOREIGN KEY (`pharmacyRecycleLogId`) REFERENCES `PharmacyRecycleLog`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
