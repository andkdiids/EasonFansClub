CREATE TABLE `CantonesePronunciationAssessment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `contentId` VARCHAR(191) NOT NULL,
    `assessmentMode` VARCHAR(32) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `providerVersion` VARCHAR(64) NOT NULL,
    `assessmentVersion` VARCHAR(64) NOT NULL,
    `expectedText` TEXT NOT NULL,
    `recognizedText` TEXT NULL,
    `overallScore` DOUBLE NULL,
    `pronunciationScore` DOUBLE NULL,
    `toneScore` DOUBLE NULL,
    `fluencyScore` DOUBLE NULL,
    `completenessScore` DOUBLE NULL,
    `confidence` DOUBLE NULL,
    `wordResults` JSON NULL,
    `syllableResults` JSON NULL,
    `feedback` JSON NULL,
    `recordingDurationMs` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CantonesePronunciationAssessment_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `CantonesePronunciationAssessment_contentId_createdAt_idx`(`contentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CantonesePronunciationAssessment` ADD CONSTRAINT `CantonesePronunciationAssessment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
