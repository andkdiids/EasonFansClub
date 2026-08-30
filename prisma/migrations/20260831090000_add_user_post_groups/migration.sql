CREATE TABLE `UserPostGroup` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(20) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `UserPostGroup_userId_name_key` (`userId`, `name`),
    INDEX `UserPostGroup_userId_sortOrder_createdAt_idx` (`userId`, `sortOrder`, `createdAt`),
    CONSTRAINT `UserPostGroup_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Post`
    ADD COLUMN `userPostGroupId` VARCHAR(191) NULL,
    ADD INDEX `Post_authorId_userPostGroupId_createdAt_idx` (`authorId`, `userPostGroupId`, `createdAt`),
    ADD CONSTRAINT `Post_userPostGroupId_fkey` FOREIGN KEY (`userPostGroupId`) REFERENCES `UserPostGroup` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
