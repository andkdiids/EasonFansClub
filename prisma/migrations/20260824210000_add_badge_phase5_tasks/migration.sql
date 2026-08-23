-- Phase 5: private badge tracking and progress-notification preference.
ALTER TABLE `User`
  ADD COLUMN `showBadgeProgressNotifications` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `UserBadgeTracking` (
  `id` VARCHAR(191) NOT NULL,
  `lastMilestone` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `badgeId` VARCHAR(191) NOT NULL,

  UNIQUE INDEX `UserBadgeTracking_userId_badgeId_key`(`userId`, `badgeId`),
  INDEX `UserBadgeTracking_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `UserBadgeTracking_badgeId_idx`(`badgeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserBadgeTracking`
  ADD CONSTRAINT `UserBadgeTracking_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `UserBadgeTracking`
  ADD CONSTRAINT `UserBadgeTracking_badgeId_fkey`
  FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
