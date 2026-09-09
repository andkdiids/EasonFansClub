-- Expand personal notification content before adding activity-targeted batches.
-- Existing notification rows are preserved; this is an in-place widening change.
ALTER TABLE `Notification`
    MODIFY `content` TEXT NULL,
    ADD COLUMN `imageUrl` TEXT NULL,
    ADD COLUMN `activityId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ActivityNotificationBatch` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `imageUrl` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'SENDING',
    `recipientCount` INTEGER NOT NULL,
    `sentCount` INTEGER NOT NULL DEFAULT 0,
    `skippedCount` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ActivityNotificationBatch_idempotencyKey_key`(`idempotencyKey`),
    INDEX `ActivityNotificationBatch_activityId_createdAt_idx`(`activityId`, `createdAt`),
    INDEX `ActivityNotificationBatch_createdById_createdAt_idx`(`createdById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Notification_activityId_createdAt_idx` ON `Notification`(`activityId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `ActivityNotificationBatch` ADD CONSTRAINT `ActivityNotificationBatch_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityNotificationBatch` ADD CONSTRAINT `ActivityNotificationBatch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
