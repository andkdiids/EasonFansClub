-- Optional anonymous note attached to one Shun round. Additive only: no
-- existing table or historical row is rewritten by this migration.
CREATE TABLE `ShunMasterAnonymousLetter` (
    `id` VARCHAR(191) NOT NULL,
    `roundId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,
    `hiddenAt` DATETIME(3) NULL,
    `hiddenById` VARCHAR(191) NULL,

    INDEX `ShunMasterAnonymousLetter_recipientId_createdAt_idx`(`recipientId`, `createdAt`),
    INDEX `ShunMasterAnonymousLetter_senderId_createdAt_idx`(`senderId`, `createdAt`),
    INDEX `ShunMasterAnonymousLetter_hiddenAt_idx`(`hiddenAt`),
    UNIQUE INDEX `ShunMasterAnonymousLetter_roundId_key`(`roundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
