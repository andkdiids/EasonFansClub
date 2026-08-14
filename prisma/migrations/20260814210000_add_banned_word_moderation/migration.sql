ALTER TABLE `Post`
  MODIFY `moderationStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VIOLATION') NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `DailyMessage`
  MODIFY `moderationStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VIOLATION') NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `Reply`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `DailyMessageComment`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `ProfileWallMessage`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `DirectMessage`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `Feedback`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `FeedbackReply`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `CultureComment`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `TodayEvent`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `FriendActivity`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `StickerPack`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `Sticker`
  ADD COLUMN `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `Profile`
  ADD COLUMN `displayNameModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `bioModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

ALTER TABLE `User`
  ADD COLUMN `usernameModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `nicknameModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `bioModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `moderationReason` VARCHAR(191) NULL,
  ADD COLUMN `matchedBannedWords` TEXT NULL;

CREATE TABLE `BannedWord` (
  `id` VARCHAR(191) NOT NULL,
  `word` VARCHAR(191) NOT NULL,
  `normalizedWord` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `priority` ENUM('NORMAL', 'HIGH') NOT NULL DEFAULT 'NORMAL',
  `note` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `BannedWord_normalizedWord_key`(`normalizedWord`),
  INDEX `BannedWord_enabled_priority_idx`(`enabled`, `priority`),
  INDEX `BannedWord_word_idx`(`word`),
  INDEX `BannedWord_createdById_idx`(`createdById`),
  PRIMARY KEY (`id`),
  CONSTRAINT `BannedWord_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `BannedWord` (`id`, `word`, `normalizedWord`, `enabled`, `priority`, `note`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), '神经研究所', '神经研究所', true, 'HIGH', '系统预置最高优先级词', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), '研究所', '研究所', true, 'HIGH', '系统预置最高优先级词', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'yjs', 'yjs', true, 'HIGH', '系统预置最高优先级词，大小写不敏感', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), '神经所', '神经所', true, 'HIGH', '系统预置最高优先级词', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

CREATE TABLE `ContentModerationScanJob` (
  `id` VARCHAR(191) NOT NULL,
  `status` ENUM('SCANNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'SCANNING',
  `summary` JSON NULL,
  `error` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,

  INDEX `ContentModerationScanJob_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
