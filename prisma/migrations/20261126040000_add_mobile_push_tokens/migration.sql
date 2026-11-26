-- CreateTable
CREATE TABLE `MobilePushToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `expoPushToken` VARCHAR(255) NOT NULL,
    `installationId` VARCHAR(64) NULL,
    `platform` VARCHAR(16) NOT NULL,
    `appVersion` VARCHAR(32) NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `failureCount` INTEGER NOT NULL DEFAULT 0,
    `lastFailureAt` DATETIME(3) NULL,
    `lastFailureReason` VARCHAR(255) NULL,
    `lastRegisteredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MobilePushToken_expoPushToken_key`(`expoPushToken`),
    INDEX `MobilePushToken_userId_status_idx`(`userId`, `status`),
    INDEX `MobilePushToken_status_updatedAt_idx`(`status`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MobilePushDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `payload` JSON NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastError` VARCHAR(255) NULL,
    `tokenCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MobilePushDelivery_dedupeKey_key`(`dedupeKey`),
    INDEX `MobilePushDelivery_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `MobilePushDelivery_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
