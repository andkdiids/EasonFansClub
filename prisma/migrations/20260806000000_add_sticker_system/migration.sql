-- CreateEnum
CREATE TABLE `StickerPack` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191),
    `coverUrl` VARCHAR(191),
    `creatorId` VARCHAR(191) NOT NULL,
    `type` ENUM('STATIC','GIF') NOT NULL DEFAULT 'STATIC',
    `status` ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
    `rejectionReason` TEXT,
    `reviewedAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sticker` (
    `id` VARCHAR(191) NOT NULL,
    `packId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(32),
    `url` VARCHAR(191) NOT NULL,
    `type` ENUM('STATIC','GIF') NOT NULL DEFAULT 'STATIC',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserStickerPack` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `packId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `StickerPack_creatorId_createdAt_idx` ON `StickerPack` (`creatorId`, `createdAt`);

-- CreateIndex
CREATE INDEX `StickerPack_status_createdAt_idx` ON `StickerPack` (`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `Sticker_packId_sort_idx` ON `Sticker` (`packId`, `sort`);

-- CreateIndex
CREATE UNIQUE INDEX `UserStickerPack_userId_packId_key` ON `UserStickerPack` (`userId`, `packId`);

-- CreateIndex
CREATE INDEX `UserStickerPack_userId_createdAt_idx` ON `UserStickerPack` (`userId`, `createdAt`);

-- CreateIndex
CREATE INDEX `UserStickerPack_packId_idx` ON `UserStickerPack` (`packId`);

-- AddForeignKey
ALTER TABLE `StickerPack` ADD CONSTRAINT `StickerPack_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sticker` ADD CONSTRAINT `Sticker_packId_fkey` FOREIGN KEY (`packId`) REFERENCES `StickerPack` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserStickerPack` ADD CONSTRAINT `UserStickerPack_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserStickerPack` ADD CONSTRAINT `UserStickerPack_packId_fkey` FOREIGN KEY (`packId`) REFERENCES `StickerPack` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
