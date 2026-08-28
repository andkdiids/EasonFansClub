CREATE TABLE `UserPrivacySetting` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `showCheckInHistory` BOOLEAN NOT NULL DEFAULT true,
  `showCheckInMessages` BOOLEAN NOT NULL DEFAULT true,
  `showPosts` BOOLEAN NOT NULL DEFAULT true,
  `showComments` BOOLEAN NOT NULL DEFAULT true,
  `showConcertHistory` BOOLEAN NOT NULL DEFAULT true,
  `showActivityHistory` BOOLEAN NOT NULL DEFAULT true,
  `showBadgeHistory` BOOLEAN NOT NULL DEFAULT true,
  `showRatings` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `UserPrivacySetting_userId_key` (`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserPrivacySetting`
  ADD CONSTRAINT `UserPrivacySetting_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
