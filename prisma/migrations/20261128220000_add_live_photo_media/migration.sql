-- 私家E院 Web 实况照片：统一媒体资产、受控转码状态与旧版静态封面兼容。
-- 纯增量迁移：历史 IMAGE/VIDEO 记录与 PostMedia.url 均不修改。

CREATE TABLE `LivePhotoAsset` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(191) NOT NULL,
    `sourceCoverKey` VARCHAR(500) NOT NULL,
    `sourceVideoKey` VARCHAR(500) NOT NULL,
    `coverKey` VARCHAR(500) NULL,
    `thumbnailKey` VARCHAR(500) NULL,
    `videoKey` VARCHAR(500) NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `stage` VARCHAR(64) NULL,
    `errorCode` VARCHAR(64) NULL,
    `errorMessage` TEXT NULL,
    `pairing` VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `videoCodec` VARCHAR(64) NULL,
    `audioCodec` VARCHAR(64) NULL,
    `hasAudio` BOOLEAN NOT NULL DEFAULT false,
    `size` INTEGER NULL,
    `widthSource` INTEGER NULL,
    `heightSource` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `processedAt` DATETIME(3) NULL,

    UNIQUE INDEX `LivePhotoAsset_requestKey_key`(`requestKey`),
    INDEX `LivePhotoAsset_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    INDEX `LivePhotoAsset_status_updatedAt_idx`(`status`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PostMedia`
    MODIFY `type` ENUM('IMAGE', 'VIDEO', 'LIVE_PHOTO') NOT NULL;

ALTER TABLE `PostMedia`
    ADD COLUMN `livePhotoId` VARCHAR(191) NULL;

CREATE INDEX `PostMedia_livePhotoId_idx` ON `PostMedia`(`livePhotoId`);

ALTER TABLE `LivePhotoAsset`
    ADD CONSTRAINT `LivePhotoAsset_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PostMedia`
    ADD CONSTRAINT `PostMedia_livePhotoId_fkey` FOREIGN KEY (`livePhotoId`) REFERENCES `LivePhotoAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
