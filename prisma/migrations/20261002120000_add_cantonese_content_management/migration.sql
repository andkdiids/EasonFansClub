ALTER TABLE `CantoneseLessonContent`
    ADD COLUMN `contentType` VARCHAR(32) NOT NULL DEFAULT 'CONCEPT',
    ADD COLUMN `translation` TEXT NULL,
    ADD COLUMN `explanation` TEXT NULL,
    ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `requiresAudio` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `requiresSpeaking` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `CantoneseLessonContent_lessonId_stageId_stepId_sortOrder_idx`
    ON `CantoneseLessonContent`(`lessonId`, `stageId`, `stepId`, `sortOrder`);

ALTER TABLE `CantoneseQuestion`
    ADD COLUMN `speakingReferenceId` VARCHAR(191) NULL,
    ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `CantoneseQuestion_lessonId_stageId_questionType_sortOrder_idx`
    ON `CantoneseQuestion`(`lessonId`, `stageId`, `questionType`, `sortOrder`);

ALTER TABLE `CantoneseAudioAsset`
    ADD COLUMN `audioKey` VARCHAR(512) NULL,
    ADD COLUMN `voiceProfile` VARCHAR(64) NOT NULL DEFAULT '101019',
    ADD COLUMN `speed` DOUBLE NULL,
    ADD COLUMN `sampleRate` INTEGER NOT NULL DEFAULT 16000,
    ADD COLUMN `codec` VARCHAR(16) NOT NULL DEFAULT 'mp3',
    ADD COLUMN `notes` TEXT NULL;

CREATE UNIQUE INDEX `CantoneseAudioAsset_audioKey_key` ON `CantoneseAudioAsset`(`audioKey`);
