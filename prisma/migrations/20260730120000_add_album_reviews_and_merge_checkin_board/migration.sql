CREATE TABLE `AlbumReview` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `coverUrl` TEXT NULL,
  `content` LONGTEXT NOT NULL,
  `images` JSON NOT NULL,
  `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  `likeCount` INTEGER NOT NULL DEFAULT 0,
  `favoriteCount` INTEGER NOT NULL DEFAULT 0,
  `publishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `albumId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,

  INDEX `AlbumReview_albumId_status_publishedAt_idx`(`albumId`, `status`, `publishedAt`),
  INDEX `AlbumReview_authorId_createdAt_idx`(`authorId`, `createdAt`),
  INDEX `AlbumReview_status_publishedAt_createdAt_idx`(`status`, `publishedAt`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AlbumReviewLike` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,

  UNIQUE INDEX `AlbumReviewLike_reviewId_userId_key`(`reviewId`, `userId`),
  INDEX `AlbumReviewLike_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AlbumReviewFavorite` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,

  UNIQUE INDEX `AlbumReviewFavorite_reviewId_userId_key`(`reviewId`, `userId`),
  INDEX `AlbumReviewFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AlbumReview`
  ADD CONSTRAINT `AlbumReview_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `AlbumReview_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AlbumReviewLike`
  ADD CONSTRAINT `AlbumReviewLike_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `AlbumReview`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `AlbumReviewLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AlbumReviewFavorite`
  ADD CONSTRAINT `AlbumReviewFavorite_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `AlbumReview`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `AlbumReviewFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

SET @daily_chat_board_id = (
  SELECT `id` FROM `Board` WHERE `slug` = 'daily-chat' LIMIT 1
);

UPDATE `Post`
SET `boardId` = @daily_chat_board_id
WHERE @daily_chat_board_id IS NOT NULL
  AND `boardId` IN (SELECT `id` FROM `Board` WHERE `slug` = 'checkin');

UPDATE `Board`
SET `postCount` = (
  SELECT COUNT(*) FROM `Post` WHERE `Post`.`boardId` = `Board`.`id`
)
WHERE `slug` = 'daily-chat';

UPDATE `Board`
SET `isActive` = FALSE,
    `postCount` = 0
WHERE `slug` = 'checkin';
