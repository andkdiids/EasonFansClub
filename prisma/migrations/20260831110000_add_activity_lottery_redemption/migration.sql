ALTER TABLE `Lottery`
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `drawAt` DATETIME(3) NULL,
  ADD COLUMN `status` ENUM('DRAFT', 'SCHEDULED', 'DRAWN', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `eligibleCount` INTEGER NULL,
  ADD COLUMN `winnerCount` INTEGER NULL,
  ADD COLUMN `drawnAt` DATETIME(3) NULL,
  ADD COLUMN `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN `algorithmVersion` VARCHAR(191) NULL,
  ADD COLUMN `createdById` VARCHAR(191) NULL,
  ADD INDEX `Lottery_activityId_status_drawAt_idx`(`activityId`, `status`, `drawAt`),
  ADD INDEX `Lottery_status_drawAt_idx`(`status`, `drawAt`),
  ADD INDEX `Lottery_createdById_idx`(`createdById`);

ALTER TABLE `LotteryEntry`
  ADD COLUMN `wonAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `registrationId` VARCHAR(191) NULL,
  ADD COLUMN `redemptionStatus` ENUM('PENDING', 'REDEEMED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `redeemedAt` DATETIME(3) NULL,
  ADD COLUMN `redeemedByAdminId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `LotteryEntry_lotteryId_userId_key`(`lotteryId`, `userId`),
  ADD INDEX `LotteryEntry_registrationId_idx`(`registrationId`),
  ADD INDEX `LotteryEntry_redeemedByAdminId_redeemedAt_idx`(`redeemedByAdminId`, `redeemedAt`);

ALTER TABLE `LotteryPrize`
  ADD COLUMN `tierName` VARCHAR(160) NULL,
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `imageUrl` TEXT NULL,
  ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
  ADD INDEX `LotteryPrize_lotteryId_sortOrder_id_idx`(`lotteryId`, `sortOrder`, `id`);

ALTER TABLE `Lottery`
  ADD CONSTRAINT `Lottery_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `LotteryEntry`
  ADD CONSTRAINT `LotteryEntry_registrationId_fkey`
  FOREIGN KEY (`registrationId`) REFERENCES `ActivityRegistration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `LotteryEntry_redeemedByAdminId_fkey`
  FOREIGN KEY (`redeemedByAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
