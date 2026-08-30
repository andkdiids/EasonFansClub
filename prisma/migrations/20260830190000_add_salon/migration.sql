CREATE TABLE `SalonPost` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `category` ENUM('CONCERT', 'MOBILE_WALLPAPER', 'DESKTOP_WALLPAPER') NOT NULL,
  `concertId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(200) NULL,
  `content` TEXT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `rejectReason` TEXT NULL,
  `likeCount` INTEGER NOT NULL DEFAULT 0,
  `commentCount` INTEGER NOT NULL DEFAULT 0,
  `approvedAt` DATETIME(3) NULL,
  `approvedById` VARCHAR(191) NULL,
  `submissionKey` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SalonPost_userId_submissionKey_key`(`userId`, `submissionKey`),
  INDEX `SalonPost_status_approvedAt_idx`(`status`, `approvedAt`),
  INDEX `SalonPost_category_status_approvedAt_idx`(`category`, `status`, `approvedAt`),
  INDEX `SalonPost_concertId_status_approvedAt_idx`(`concertId`, `status`, `approvedAt`),
  INDEX `SalonPost_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SalonPostMedia` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `originalUrl` TEXT NOT NULL,
  `previewUrl` TEXT NOT NULL,
  `thumbnailUrl` TEXT NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `width` INTEGER NOT NULL,
  `height` INTEGER NOT NULL,
  `sortOrder` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SalonPostMedia_postId_sortOrder_key`(`postId`, `sortOrder`),
  INDEX `SalonPostMedia_postId_sortOrder_idx`(`postId`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SalonPostLike` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SalonPostLike_postId_userId_key`(`postId`, `userId`),
  INDEX `SalonPostLike_postId_idx`(`postId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SalonComment` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `parentId` VARCHAR(191) NULL,
  `content` TEXT NOT NULL,
  `isDeleted` BOOLEAN NOT NULL DEFAULT false,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `SalonComment_postId_parentId_createdAt_idx`(`postId`, `parentId`, `createdAt`),
  INDEX `SalonComment_authorId_createdAt_idx`(`authorId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SalonPost`
  ADD CONSTRAINT `SalonPost_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SalonPost_concertId_fkey`
  FOREIGN KEY (`concertId`) REFERENCES `MusicConcert`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SalonPost_approvedById_fkey`
  FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalonPostMedia`
  ADD CONSTRAINT `SalonPostMedia_postId_fkey`
  FOREIGN KEY (`postId`) REFERENCES `SalonPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SalonPostLike`
  ADD CONSTRAINT `SalonPostLike_postId_fkey`
  FOREIGN KEY (`postId`) REFERENCES `SalonPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SalonPostLike_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SalonComment`
  ADD CONSTRAINT `SalonComment_postId_fkey`
  FOREIGN KEY (`postId`) REFERENCES `SalonPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SalonComment_authorId_fkey`
  FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SalonComment_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `SalonComment`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
