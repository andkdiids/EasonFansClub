-- Add like support for daily-message comments so the notification center can
-- offer a quick-like on the comment the recipient was replied to (评论回复).
-- Counts are derived from this table (no denormalized counter on the comment).

CREATE TABLE `DailyMessageCommentLike` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `commentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `DailyMessageCommentLike_commentId_userId_key` (`commentId`, `userId`),
    INDEX `DailyMessageCommentLike_commentId_createdAt_idx` (`commentId`, `createdAt`),
    INDEX `DailyMessageCommentLike_userId_createdAt_idx` (`userId`, `createdAt`),
    CONSTRAINT `DailyMessageCommentLike_commentId_fkey`
        FOREIGN KEY (`commentId`) REFERENCES `DailyMessageComment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `DailyMessageCommentLike_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
