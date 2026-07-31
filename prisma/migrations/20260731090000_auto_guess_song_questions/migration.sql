-- Add AUTO question support: quiz questions can be generated automatically from
-- the published EasMusic library, driven by a singleton config row. All changes
-- are additive and preserve existing questions, sessions and audio objects.

ALTER TABLE `GuessSongQuestion`
  ADD COLUMN `questionType` VARCHAR(191) NOT NULL DEFAULT 'MANUAL';

CREATE INDEX `GuessSongQuestion_questionType_enabled_processingStatus_idx`
  ON `GuessSongQuestion`(`questionType`, `enabled`, `processingStatus`);

ALTER TABLE `GuessSongSession`
  ADD COLUMN `questionCount` INTEGER NULL;

CREATE TABLE `GuessSongQuizConfig` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'global',
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `sourceType` VARCHAR(191) NOT NULL DEFAULT 'ALL',
  `albumId` VARCHAR(191) NULL,
  `year` INTEGER NULL,
  `difficulty` ENUM('EASY', 'ADVANCED', 'HARD') NOT NULL DEFAULT 'EASY',
  `questionCount` INTEGER NOT NULL DEFAULT 10,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
