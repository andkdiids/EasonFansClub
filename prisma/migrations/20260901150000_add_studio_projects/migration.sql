CREATE TABLE `StudioProject` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `toolSlug` VARCHAR(64) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `description` TEXT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `data` JSON NOT NULL,
  `thumbnailUrl` TEXT NULL,
  `likeCount` INTEGER NOT NULL DEFAULT 0,
  `favoriteCount` INTEGER NOT NULL DEFAULT 0,
  `viewCount` INTEGER NOT NULL DEFAULT 0,
  `visibility` ENUM('PRIVATE', 'PUBLIC', 'UNLISTED') NOT NULL DEFAULT 'PRIVATE',
  `reviewStatus` ENUM('NONE', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NONE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `lastOpenedAt` DATETIME(3) NULL,

  PRIMARY KEY (`id`),
  INDEX `StudioProject_userId_updatedAt_idx` (`userId`, `updatedAt`),
  INDEX `StudioProject_toolSlug_visibility_reviewStatus_updatedAt_idx` (`toolSlug`, `visibility`, `reviewStatus`, `updatedAt`),
  INDEX `StudioProject_visibility_reviewStatus_likeCount_updatedAt_idx` (`visibility`, `reviewStatus`, `likeCount`, `updatedAt`),
  CONSTRAINT `StudioProject_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StudioProjectLike` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `projectId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `StudioProjectLike_projectId_userId_key` (`projectId`, `userId`),
  INDEX `StudioProjectLike_projectId_createdAt_idx` (`projectId`, `createdAt`),
  INDEX `StudioProjectLike_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `StudioProjectLike_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `StudioProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `StudioProjectLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StudioProjectFavorite` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `projectId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `StudioProjectFavorite_projectId_userId_key` (`projectId`, `userId`),
  INDEX `StudioProjectFavorite_projectId_createdAt_idx` (`projectId`, `createdAt`),
  INDEX `StudioProjectFavorite_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `StudioProjectFavorite_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `StudioProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `StudioProjectFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
