ALTER TABLE `UserPrivacySetting`
  ADD COLUMN `showFavorites` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `ProfilePostViewHistory` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `viewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ProfilePostViewHistory_userId_postId_key` (`userId`, `postId`),
  INDEX `ProfilePostViewHistory_userId_viewedAt_idx` (`userId`, `viewedAt`),
  INDEX `ProfilePostViewHistory_postId_idx` (`postId`),
  CONSTRAINT `ProfilePostViewHistory_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProfilePostViewHistory_postId_fkey`
    FOREIGN KEY (`postId`) REFERENCES `Post` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
