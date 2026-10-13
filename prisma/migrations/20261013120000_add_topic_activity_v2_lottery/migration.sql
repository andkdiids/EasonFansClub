-- Phase A: UNRELEASED lottery draft, new tables only. Existing migration history
-- must never be rewritten if this draft was applied to a shared environment.
-- Each DDL commits independently. Stop on the first error; inspect before repair.
SET SESSION foreign_key_checks = 1;
SET SESSION lock_wait_timeout = 5;

-- CreateTable
CREATE TABLE `TopicActivityLottery` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `lotteryId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `config` JSON NOT NULL,
    `state` VARCHAR(32) NOT NULL DEFAULT 'COLLECTING',
    `drawAt` DATETIME(3) NULL,
    `fairnessLockedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TopicLottery_activity_key`(`activityId`),
    UNIQUE INDEX `TopicLottery_lottery_key`(`lotteryId`),
    INDEX `TopicLottery_due_idx`(`enabled`, `state`, `drawAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopicActivityLotteryEligibility` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `lotteryConfigId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sourceSubmissionId` VARCHAR(191) NULL,
    `sourceSnapshot` JSON NOT NULL,
    `valid` BOOLEAN NOT NULL DEFAULT true,
    `qualifiedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TopicLotteryEligibility_valid_idx`(`lotteryConfigId`, `valid`, `qualifiedAt`),
    UNIQUE INDEX `TopicLotteryEligibility_activity_user_key`(`activityId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopicActivityLotteryDraw` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `lotteryConfigId` VARCHAR(191) NOT NULL,
    `state` VARCHAR(32) NOT NULL DEFAULT 'FROZEN',
    `frozenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `frozenById` VARCHAR(191) NULL,
    `candidateCount` INTEGER NOT NULL,
    `candidateSnapshot` JSON NOT NULL,
    `candidateHash` VARCHAR(64) NOT NULL,
    `prizeSnapshot` JSON NOT NULL,
    `allocation` JSON NULL,
    `allocationHash` VARCHAR(64) NULL,
    `winnerCount` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NULL,
    `drawnAt` DATETIME(3) NULL,
    `errorCode` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TopicLotteryDraw_activity_key`(`activityId`),
    UNIQUE INDEX `TopicLotteryDraw_config_key`(`lotteryConfigId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopicActivityLotterySlot` (
    `id` VARCHAR(191) NOT NULL,
    `prizeId` VARCHAR(191) NOT NULL,
    `slotNumber` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TopicLotterySlot_prize_number_key`(`prizeId`, `slotNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopicActivityLotteryShipping` (
    `id` VARCHAR(191) NOT NULL,
    `winnerId` VARCHAR(191) NOT NULL,
    `addressCiphertext` LONGTEXT NULL,
    `shipmentCiphertext` LONGTEXT NULL,
    `addressDeadline` DATETIME(3) NOT NULL,
    `retainUntil` DATETIME(3) NOT NULL,
    `addressUpdatedAt` DATETIME(3) NULL,
    `consentAt` DATETIME(3) NULL,
    `shippingStatus` VARCHAR(32) NOT NULL DEFAULT 'WAITING_ADDRESS',
    `shippedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TopicLotteryShipping_winner_key`(`winnerId`),
    INDEX `TopicLotteryShipping_retention_idx`(`retainUntil`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopicActivityLotteryNotice` (
    `id` VARCHAR(191) NOT NULL,
    `winnerId` VARCHAR(191) NOT NULL,
    `state` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `errorCode` VARCHAR(100) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TopicLotteryNotice_winner_key`(`winnerId`),
    INDEX `TopicLotteryNotice_pending_idx`(`state`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopicActivityLotteryAudit` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `lotteryConfigId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(64) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TopicLotteryAudit_config_time_idx`(`lotteryConfigId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TopicActivityLottery` ADD CONSTRAINT `TopicActivityLottery_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLottery` ADD CONSTRAINT `TopicActivityLottery_lotteryId_fkey` FOREIGN KEY (`lotteryId`) REFERENCES `Lottery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryEligibility` ADD CONSTRAINT `TopicActivityLotteryEligibility_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryEligibility` ADD CONSTRAINT `TopicActivityLotteryEligibility_lotteryConfigId_fkey` FOREIGN KEY (`lotteryConfigId`) REFERENCES `TopicActivityLottery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryEligibility` ADD CONSTRAINT `TopicActivityLotteryEligibility_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryEligibility` ADD CONSTRAINT `TopicActivityLotteryEligibility_sourceSubmissionId_fkey` FOREIGN KEY (`sourceSubmissionId`) REFERENCES `TopicActivitySubmission`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryDraw` ADD CONSTRAINT `TopicActivityLotteryDraw_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryDraw` ADD CONSTRAINT `TopicActivityLotteryDraw_lotteryConfigId_fkey` FOREIGN KEY (`lotteryConfigId`) REFERENCES `TopicActivityLottery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotterySlot` ADD CONSTRAINT `TopicActivityLotterySlot_prizeId_fkey` FOREIGN KEY (`prizeId`) REFERENCES `LotteryPrize`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryShipping` ADD CONSTRAINT `TopicActivityLotteryShipping_winnerId_fkey` FOREIGN KEY (`winnerId`) REFERENCES `LotteryEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryNotice` ADD CONSTRAINT `TopicActivityLotteryNotice_winnerId_fkey` FOREIGN KEY (`winnerId`) REFERENCES `LotteryEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryAudit` ADD CONSTRAINT `TopicActivityLotteryAudit_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryAudit` ADD CONSTRAINT `TopicActivityLotteryAudit_lotteryConfigId_fkey` FOREIGN KEY (`lotteryConfigId`) REFERENCES `TopicActivityLottery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopicActivityLotteryAudit` ADD CONSTRAINT `TopicActivityLotteryAudit_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
