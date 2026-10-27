ALTER TABLE `ConcertEvent`
  ADD COLUMN `backgroundImageUrl` TEXT NULL;

CREATE TABLE `ConcertDiscussionComment` (
  `id` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `showId` VARCHAR(191) NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(36) NOT NULL,
  `content` TEXT NOT NULL,
  `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
  `moderationReason` TEXT NULL,
  `isDeleted` BOOLEAN NOT NULL DEFAULT false,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ConcertDiscussionComment_author_request_key` (`authorId`, `requestId`),
  INDEX `ConcertDiscussionComment_scope_feed_idx` (`eventId`, `showId`, `moderationStatus`, `isDeleted`, `createdAt`),
  INDEX `ConcertDiscussionComment_author_created_idx` (`authorId`, `createdAt`),
  CONSTRAINT `ConcertDiscussionComment_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `ConcertEvent` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConcertDiscussionComment_showId_fkey` FOREIGN KEY (`showId`) REFERENCES `ConcertShow` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConcertDiscussionComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `ConcertDiscussionImage` (
  `id` VARCHAR(191) NOT NULL,
  `commentId` VARCHAR(191) NOT NULL,
  `url` TEXT NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ConcertDiscussionImage_comment_order_idx` (`commentId`, `sortOrder`),
  CONSTRAINT `ConcertDiscussionImage_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `ConcertDiscussionComment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
