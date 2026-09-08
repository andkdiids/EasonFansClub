-- Store one private, account-owned new-post draft per user.
-- This migration is intentionally created but not executed in this task.
CREATE TABLE `PostDraft` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `boardId` VARCHAR(191) NULL,
    `title` VARCHAR(120) NOT NULL,
    `content` TEXT NOT NULL,
    `richContent` JSON NULL,
    `imageUrls` JSON NOT NULL,
    `pendingSticker` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PostDraft_userId_key`(`userId`),
    INDEX `PostDraft_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PostDraft`
    ADD CONSTRAINT `PostDraft_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
