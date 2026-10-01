CREATE TABLE `CantoneseLessonContent` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `lessonId` VARCHAR(32) NOT NULL,
    `stageId` VARCHAR(64) NOT NULL,
    `stepId` VARCHAR(100) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `displayText` TEXT NULL,
    `jyutping` VARCHAR(255) NULL,
    `tone` VARCHAR(64) NULL,
    `examples` JSON NULL,
    `audioId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'CONTENT_REVIEW_REQUIRED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'CONTENT_REVIEW_REQUIRED',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CantoneseLessonContent_externalId_key`(`externalId`),
    INDEX `CantoneseLessonContent_lessonId_stageId_stepId_idx`(`lessonId`, `stageId`, `stepId`),
    INDEX `CantoneseLessonContent_status_updatedAt_idx`(`status`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CantoneseQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `lessonId` VARCHAR(32) NOT NULL,
    `stageId` VARCHAR(64) NOT NULL,
    `questionType` VARCHAR(40) NOT NULL,
    `prompt` LONGTEXT NOT NULL,
    `options` JSON NOT NULL,
    `correctAnswer` JSON NOT NULL,
    `explanation` LONGTEXT NOT NULL,
    `prerequisiteContentIds` JSON NOT NULL,
    `audioId` VARCHAR(191) NULL,
    `lyricPrescriptionId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'CONTENT_REVIEW_REQUIRED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'CONTENT_REVIEW_REQUIRED',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CantoneseQuestion_externalId_key`(`externalId`),
    INDEX `CantoneseQuestion_lessonId_stageId_questionType_idx`(`lessonId`, `stageId`, `questionType`),
    INDEX `CantoneseQuestion_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `CantoneseQuestion_lyricPrescriptionId_idx`(`lyricPrescriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CantoneseAudioAsset` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `jyutping` VARCHAR(255) NULL,
    `lessonId` VARCHAR(32) NULL,
    `contentId` VARCHAR(191) NULL,
    `cosKey` VARCHAR(512) NULL,
    `audioVersion` VARCHAR(32) NOT NULL DEFAULT 'v1',
    `checksum` CHAR(64) NULL,
    `fileSize` INTEGER NULL,
    `assetStatus` ENUM('NOT_GENERATED', 'GENERATING', 'READY', 'FAILED', 'NEEDS_REGENERATION') NOT NULL DEFAULT 'NOT_GENERATED',
    `status` ENUM('DRAFT', 'CONTENT_REVIEW_REQUIRED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'CONTENT_REVIEW_REQUIRED',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CantoneseAudioAsset_externalId_key`(`externalId`),
    INDEX `CantoneseAudioAsset_lessonId_contentId_idx`(`lessonId`, `contentId`),
    INDEX `CantoneseAudioAsset_assetStatus_status_idx`(`assetStatus`, `status`),
    INDEX `CantoneseAudioAsset_status_updatedAt_idx`(`status`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CantoneseReviewLog` (
    `id` VARCHAR(191) NOT NULL,
    `reviewerId` VARCHAR(191) NULL,
    `targetType` VARCHAR(32) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `oldStatus` ENUM('DRAFT', 'CONTENT_REVIEW_REQUIRED', 'APPROVED', 'REJECTED') NULL,
    `newStatus` ENUM('DRAFT', 'CONTENT_REVIEW_REQUIRED', 'APPROVED', 'REJECTED') NOT NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CantoneseReviewLog_targetType_targetId_createdAt_idx`(`targetType`, `targetId`, `createdAt`),
    INDEX `CantoneseReviewLog_reviewerId_createdAt_idx`(`reviewerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CantoneseLessonContent` ADD CONSTRAINT `CantoneseLessonContent_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CantoneseQuestion` ADD CONSTRAINT `CantoneseQuestion_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CantoneseQuestion` ADD CONSTRAINT `CantoneseQuestion_lyricPrescriptionId_fkey` FOREIGN KEY (`lyricPrescriptionId`) REFERENCES `LyricPrescription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CantoneseAudioAsset` ADD CONSTRAINT `CantoneseAudioAsset_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CantoneseReviewLog` ADD CONSTRAINT `CantoneseReviewLog_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
