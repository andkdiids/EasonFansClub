-- CreateTable
CREATE TABLE `ShunItemGiftIntent` (
    `id` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `code` ENUM('EXTRA_ATTEMPT', 'FRIEND_GIFT', 'EXTRA_SUSPECT', 'REVENGE', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE') NOT NULL,
    `configVersion` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'SETTLED', 'TERMINATED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `giftId` VARCHAR(191) NULL,
    `result` JSON NULL,

    UNIQUE INDEX `ShunItemGiftIntent_giftId_key`(`giftId`),
    INDEX `ShunItemGiftIntent_status_createdAt_idx`(`status`, `createdAt`),
    UNIQUE INDEX `ShunItemGiftIntent_senderId_requestKey_key`(`senderId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ShunItemGiftIntent` ADD CONSTRAINT `ShunItemGiftIntent_configVersion_fkey` FOREIGN KEY (`configVersion`) REFERENCES `ShunItemConfigVersion`(`version`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShunItemGiftIntent` ADD CONSTRAINT `ShunItemGiftIntent_giftId_fkey` FOREIGN KEY (`giftId`) REFERENCES `ShunItemGift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
