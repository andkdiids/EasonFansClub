CREATE TABLE `Rating` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `targetType` ENUM('SONG', 'ALBUM') NOT NULL,
  `songId` VARCHAR(191) NULL,
  `albumId` VARCHAR(191) NULL,
  `score` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Rating_userId_songId_key` (`userId`, `songId`),
  UNIQUE INDEX `Rating_userId_albumId_key` (`userId`, `albumId`),
  INDEX `Rating_targetType_songId_createdAt_idx` (`targetType`, `songId`, `createdAt`),
  INDEX `Rating_targetType_albumId_createdAt_idx` (`targetType`, `albumId`, `createdAt`),
  INDEX `Rating_userId_createdAt_idx` (`userId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `Rating_score_range_chk` CHECK (`score` BETWEEN 1 AND 10)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RatingReview` (
  `id` VARCHAR(191) NOT NULL,
  `ratingId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `likeCount` INTEGER NOT NULL DEFAULT 0,
  `activeKey` VARCHAR(191) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `RatingReview_activeKey_key` (`activeKey`),
  INDEX `RatingReview_ratingId_deletedAt_createdAt_idx` (`ratingId`, `deletedAt`, `createdAt`),
  INDEX `RatingReview_userId_deletedAt_createdAt_idx` (`userId`, `deletedAt`, `createdAt`),
  INDEX `RatingReview_deletedAt_likeCount_createdAt_idx` (`deletedAt`, `likeCount`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RatingReviewLike` (
  `id` VARCHAR(191) NOT NULL,
  `reviewId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `RatingReviewLike_reviewId_userId_key` (`reviewId`, `userId`),
  INDEX `RatingReviewLike_userId_createdAt_idx` (`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RatingStats` (
  `id` VARCHAR(191) NOT NULL,
  `targetType` ENUM('SONG', 'ALBUM') NOT NULL,
  `songId` VARCHAR(191) NULL,
  `albumId` VARCHAR(191) NULL,
  `ratingCount` INTEGER NOT NULL DEFAULT 0,
  `ratingScoreTotal` INTEGER NOT NULL DEFAULT 0,
  `averageScore` DOUBLE NOT NULL DEFAULT 0,
  `reviewCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `RatingStats_songId_key` (`songId`),
  UNIQUE INDEX `RatingStats_albumId_key` (`albumId`),
  INDEX `RatingStats_targetType_averageScore_ratingCount_idx` (`targetType`, `averageScore`, `ratingCount`),
  INDEX `RatingStats_targetType_updatedAt_idx` (`targetType`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Rating`
  ADD CONSTRAINT `Rating_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Rating_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Rating_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RatingReview`
  ADD CONSTRAINT `RatingReview_ratingId_fkey` FOREIGN KEY (`ratingId`) REFERENCES `Rating`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `RatingReview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RatingReviewLike`
  ADD CONSTRAINT `RatingReviewLike_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `RatingReview`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `RatingReviewLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `RatingStats`
  ADD CONSTRAINT `RatingStats_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `RatingStats_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
