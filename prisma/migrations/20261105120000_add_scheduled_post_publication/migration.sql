-- Separate post review from public visibility and add a durable publication outbox.
-- Existing rows keep their current public state and publishedAt values.

ALTER TABLE `Post`
    ADD COLUMN `publicationStatus` ENUM('WAITING_REVIEW', 'SCHEDULED', 'PUBLISHED', 'CANCELLED') NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN `scheduledPublishAt` DATETIME(3) NULL,
    MODIFY COLUMN `publishedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD INDEX `Post_scheduled_publish_idx` (`publicationStatus`, `moderationStatus`, `scheduledPublishAt`);

CREATE TABLE `PostPublicationEvent` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `triggerType` ENUM('POST_CREATED', 'POST_APPROVED') NOT NULL,
    `status` ENUM('WAITING', 'PENDING', 'PROCESSING', 'FAILED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'WAITING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `lockToken` VARCHAR(64) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `PostPublicationEvent_postId_key` (`postId`),
    INDEX `PostPublicationEvent_retry_idx` (`status`, `availableAt`, `lockedAt`),
    CONSTRAINT `PostPublicationEvent_postId_fkey`
        FOREIGN KEY (`postId`) REFERENCES `Post` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
