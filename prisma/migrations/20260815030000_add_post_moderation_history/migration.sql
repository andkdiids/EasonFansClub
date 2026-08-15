CREATE TABLE `PostModerationHistory` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NULL,
  `actorId` VARCHAR(191) NULL,
  `actorName` VARCHAR(191) NULL,
  `actorUsername` VARCHAR(191) NULL,
  `actorUid` INTEGER NULL,
  `action` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VIOLATION') NOT NULL,
  `titleSnapshot` VARCHAR(191) NULL,
  `rejectionReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `PostModerationHistory_postId_createdAt_idx`(`postId`, `createdAt`),
  INDEX `PostModerationHistory_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `PostModerationHistory_actorId_createdAt_idx`(`actorId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PostModerationHistory_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `PostModerationHistory_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
