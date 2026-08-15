-- Store the user's final, server-processed My Live photos separately from the attendance record.
CREATE TABLE `MyLivePhoto` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `attendanceId` VARCHAR(191) NOT NULL,
  `category` ENUM('TICKET', 'LIVE') NOT NULL,
  `imageUrl` TEXT NOT NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `width` INTEGER NOT NULL,
  `height` INTEGER NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `watermarked` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `MyLivePhoto_attendanceId_category_sortOrder_createdAt_id_idx` (`attendanceId`, `category`, `sortOrder`, `createdAt`, `id`),
  INDEX `MyLivePhoto_userId_attendanceId_idx` (`userId`, `attendanceId`),
  INDEX `MyLivePhoto_userId_createdAt_idx` (`userId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MyLivePhoto_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MyLivePhoto_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `UserMusicConcert`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
