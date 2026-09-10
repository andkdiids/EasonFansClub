-- Add a dedicated ledger source for administrator-wide registration-fee grants.
-- This is an enum expansion only; existing PointLog rows are preserved.
ALTER TABLE `PointLog`
    MODIFY `action` ENUM('POST_CREATE', 'REPLY_CREATE', 'DAILY_CHECK_IN', 'POST_LIKE_RECEIVED', 'ADMIN_ADJUST', 'REGISTER', 'LOGIN', 'CONTINUOUS_CHECK_IN_BONUS', 'FEATURED_POST', 'ACTIVITY_REWARD', 'BADGE_EXCHANGE', 'ENTERTAINMENT_DAILY_DRAW', 'POST_DAILY_FIRST', 'POST_COMMENT_DAILY', 'POST_COMMENT_RECEIVED', 'COMMENT_POST', 'COMMENT_REVOKE', 'GUESS_SONG_DUEL_WIN', 'USER_REWARD', 'CHECK_IN_MAKEUP', 'MATERIAL_REDEMPTION', 'MATERIAL_REDEMPTION_REFUND', 'ACTIVITY_REGISTRATION_FEE', 'ACTIVITY_REGISTRATION_REFUND', 'ACTIVITY_LOTTERY_PRIZE', 'PHARMACY_DRAW_COST', 'PHARMACY_PRIZE_REWARD', 'PHARMACY_DUPLICATE_RECYCLE', 'GROWTH_REWARD', 'GROWTH_REWARD_REVERSAL', 'GLOBAL_POINTS_GRANT') NOT NULL;

-- CreateTable
CREATE TABLE `GlobalPointsGrantBatch` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `imageUrl` TEXT NULL,
    `amount` INTEGER NOT NULL,
    `recipientCount` INTEGER NOT NULL,
    `totalAmount` INTEGER NOT NULL,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `GlobalPointsGrantBatch_idempotencyKey_key`(`idempotencyKey`),
    INDEX `GlobalPointsGrantBatch_createdById_createdAt_idx`(`createdById`, `createdAt`),
    INDEX `GlobalPointsGrantBatch_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GlobalPointsGrantRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `failureReason` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `GlobalPointsGrantRecipient_batchId_userId_key`(`batchId`, `userId`),
    INDEX `GlobalPointsGrantRecipient_batchId_status_id_idx`(`batchId`, `status`, `id`),
    INDEX `GlobalPointsGrantRecipient_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GlobalPointsGrantBatch` ADD CONSTRAINT `GlobalPointsGrantBatch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalPointsGrantRecipient` ADD CONSTRAINT `GlobalPointsGrantRecipient_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `GlobalPointsGrantBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GlobalPointsGrantRecipient` ADD CONSTRAINT `GlobalPointsGrantRecipient_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
