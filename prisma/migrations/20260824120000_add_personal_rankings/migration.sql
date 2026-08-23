CREATE TABLE `PersonalRanking` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `type` ENUM('SONG', 'ALBUM') NOT NULL,
  `visibility` ENUM('PRIVATE', 'PUBLIC') NOT NULL DEFAULT 'PRIVATE',
  `revision` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PersonalRanking_userId_type_key` (`userId`, `type`),
  INDEX `PersonalRanking_userId_idx` (`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PersonalRankingItem` (
  `id` VARCHAR(191) NOT NULL,
  `rankingId` VARCHAR(191) NOT NULL,
  `songId` VARCHAR(191) NULL,
  `albumId` VARCHAR(191) NULL,
  `position` INTEGER NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PersonalRankingItem_rankingId_songId_key` (`rankingId`, `songId`),
  UNIQUE INDEX `PersonalRankingItem_rankingId_albumId_key` (`rankingId`, `albumId`),
  INDEX `PersonalRankingItem_rankingId_position_idx` (`rankingId`, `position`),
  INDEX `PersonalRankingItem_songId_idx` (`songId`),
  INDEX `PersonalRankingItem_albumId_idx` (`albumId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PersonalRankingItem_position_chk` CHECK (`position` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PersonalRanking`
  ADD CONSTRAINT `PersonalRanking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PersonalRankingItem`
  ADD CONSTRAINT `PersonalRankingItem_rankingId_fkey` FOREIGN KEY (`rankingId`) REFERENCES `PersonalRanking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PersonalRankingItem_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PersonalRankingItem_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
