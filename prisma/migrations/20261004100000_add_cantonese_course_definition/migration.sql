-- Additive V6 catalog and editorial metadata. Existing rows retain their values and review status.
ALTER TABLE `CantoneseLessonContent` ADD COLUMN `contentVersion` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `dialogueId` VARCHAR(100) NULL,
    ADD COLUMN `section` VARCHAR(100) NULL,
    ADD COLUMN `sourceReference` TEXT NULL,
    ADD COLUMN `speaker` VARCHAR(16) NULL,
    ADD COLUMN `usageNote` TEXT NULL;

ALTER TABLE `CantoneseQuestion` ADD COLUMN `contentVersion` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `sourceReference` TEXT NULL;

CREATE TABLE `CantoneseCourseDefinition` (
    `id` VARCHAR(191) NOT NULL,
    `lessonId` VARCHAR(32) NOT NULL,
    `lessonNumber` INTEGER NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `subtitle` VARCHAR(255) NULL,
    `description` TEXT NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `prerequisiteLessonId` VARCHAR(32) NULL,
    `status` ENUM('DRAFT', 'CONTENT_REVIEW_REQUIRED', 'APPROVED', 'ARCHIVED') NOT NULL DEFAULT 'CONTENT_REVIEW_REQUIRED',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CantoneseCourseDefinition_lessonId_key`(`lessonId`),
    UNIQUE INDEX `CantoneseCourseDefinition_lessonNumber_key`(`lessonNumber`),
    INDEX `CantoneseCourseDefinition_status_sortOrder_idx`(`status`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
