-- CreateTable
CREATE TABLE `AnnualMemoirConfig` (
    `activityId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `previewAt` DATETIME(3) NOT NULL,
    `reservationOpensAt` DATETIME(3) NOT NULL,
    `reservationClosesAt` DATETIME(3) NOT NULL,
    `statisticsStartAt` DATETIME(3) NOT NULL,
    `statisticsEndAt` DATETIME(3) NOT NULL,
    `reportOpensAt` DATETIME(3) NOT NULL,
    `notificationAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `settlementAt` DATETIME(3) NOT NULL,
    `reservationPoints` INTEGER NOT NULL DEFAULT 74,
    `reservationBadgeId` VARCHAR(191) NULL,
    `annualBadgeId` VARCHAR(191) NULL,
    `templateVersion` INTEGER NOT NULL DEFAULT 1,
    `statisticsLockedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AnnualMemoirConfig_year_key`(`year`),
    PRIMARY KEY (`activityId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnnualMemoirReservation` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `points` INTEGER NOT NULL,
    `badgeId` VARCHAR(191) NULL,
    `pointsGrantedAt` DATETIME(3) NULL,
    `badgeGrantedAt` DATETIME(3) NULL,
    `notifiedAt` DATETIME(3) NULL,

    INDEX `AnnualMemoirReservation_activityId_notifiedAt_id_idx`(`activityId`, `notifiedAt`, `id`),
    UNIQUE INDEX `AnnualMemoirReservation_activityId_userId_key`(`activityId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnnualMemoirSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `statisticsStartAt` DATETIME(3) NOT NULL,
    `statisticsEndAt` DATETIME(3) NOT NULL,
    `templateVersion` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,

    INDEX `AnnualMemoirSnapshot_activityId_settledAt_id_idx`(`activityId`, `settledAt`, `id`),
    UNIQUE INDEX `AnnualMemoirSnapshot_userId_year_key`(`userId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AnnualMemoirConfig` ADD CONSTRAINT `AnnualMemoirConfig_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnualMemoirReservation` ADD CONSTRAINT `AnnualMemoirReservation_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnualMemoirReservation` ADD CONSTRAINT `AnnualMemoirReservation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnualMemoirSnapshot` ADD CONSTRAINT `AnnualMemoirSnapshot_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnualMemoirSnapshot` ADD CONSTRAINT `AnnualMemoirSnapshot_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
