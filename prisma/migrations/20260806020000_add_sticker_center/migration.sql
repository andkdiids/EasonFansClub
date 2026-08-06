-- AlterTable: StickerPack 增加官方表情标识与分类
ALTER TABLE `StickerPack`
  ADD COLUMN `isOfficial` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `category` VARCHAR(191),
  ADD INDEX `StickerPack_isOfficial_status_idx` (`isOfficial`, `status`);

-- AlterTable: Sticker 增加使用统计与隐藏（违规）字段
ALTER TABLE `Sticker`
  ADD COLUMN `usageCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `isHidden` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `hiddenAt` DATETIME(3),
  ADD COLUMN `hiddenReason` TEXT,
  ADD INDEX `Sticker_isHidden_idx` (`isHidden`);

-- AlterTable: DirectMessage 关联表情（发送表情包）
ALTER TABLE `DirectMessage`
  ADD COLUMN `stickerId` VARCHAR(191),
  MODIFY `type` ENUM('TEXT','IMAGE','EMOJI','SYSTEM','STICKER') NOT NULL DEFAULT 'TEXT',
  ADD INDEX `DirectMessage_stickerId_idx` (`stickerId`);

-- AlterTable: Reply 关联表情（评论发送表情）
ALTER TABLE `Reply`
  ADD COLUMN `stickerId` VARCHAR(191),
  ADD INDEX `Reply_stickerId_idx` (`stickerId`);

-- CreateTable: StickerFavorite 收藏
CREATE TABLE `StickerFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: StickerUsage 使用统计（按用户）
CREATE TABLE `StickerUsage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: StickerReport 举报
CREATE TABLE `StickerReport` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `reason` ENUM('PORN','ABUSE','VIOLATION','OTHER') NOT NULL,
    `status` ENUM('PENDING','HIDDEN','DISMISSED') NOT NULL DEFAULT 'PENDING',
    `detail` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `handledAt` DATETIME(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `StickerFavorite_userId_stickerId_key` ON `StickerFavorite` (`userId`, `stickerId`);
CREATE INDEX `StickerFavorite_userId_createdAt_idx` ON `StickerFavorite` (`userId`, `createdAt`);
CREATE INDEX `StickerFavorite_stickerId_idx` ON `StickerFavorite` (`stickerId`);

CREATE UNIQUE INDEX `StickerUsage_userId_stickerId_key` ON `StickerUsage` (`userId`, `stickerId`);
CREATE INDEX `StickerUsage_userId_lastUsedAt_idx` ON `StickerUsage` (`userId`, `lastUsedAt`);
CREATE INDEX `StickerUsage_stickerId_idx` ON `StickerUsage` (`stickerId`);

CREATE INDEX `StickerReport_status_idx` ON `StickerReport` (`status`);
CREATE INDEX `StickerReport_stickerId_idx` ON `StickerReport` (`stickerId`);
CREATE INDEX `StickerReport_userId_idx` ON `StickerReport` (`userId`);

-- AddForeignKey
ALTER TABLE `StickerFavorite` ADD CONSTRAINT `StickerFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `StickerFavorite` ADD CONSTRAINT `StickerFavorite_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `StickerUsage` ADD CONSTRAINT `StickerUsage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `StickerUsage` ADD CONSTRAINT `StickerUsage_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `StickerReport` ADD CONSTRAINT `StickerReport_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `StickerReport` ADD CONSTRAINT `StickerReport_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DirectMessage` ADD CONSTRAINT `DirectMessage_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Reply` ADD CONSTRAINT `Reply_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
