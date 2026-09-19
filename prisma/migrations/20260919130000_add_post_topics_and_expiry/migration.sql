-- Additive migration for post topics and time-limited posts.
-- No existing rows are rewritten and no production data operation is performed here.
ALTER TABLE `Post`
    ADD COLUMN `expiryType` ENUM('TODAY', 'HOURS_24', 'DAYS_3', 'DAYS_7') NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL;

ALTER TABLE `PostDraft`
    ADD COLUMN `topicNames` JSON NULL,
    ADD COLUMN `expiryType` ENUM('TODAY', 'HOURS_24', 'DAYS_3', 'DAYS_7') NULL;

CREATE INDEX `Post_expiresAt_status_isDeleted_moderationStatus_idx`
  ON `Post`(`expiresAt`, `status`, `isDeleted`, `moderationStatus`);

CREATE TABLE `Topic` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `normalizedName` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `coverImage` TEXT NULL,
  `isOfficial` BOOLEAN NOT NULL DEFAULT false,
  `activityId` VARCHAR(191) NULL,
  `startAt` DATETIME(3) NULL,
  `endAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `Topic_normalizedName_key`(`normalizedName`),
  INDEX `Topic_activityId_idx`(`activityId`),
  INDEX `Topic_isOfficial_updatedAt_idx`(`isOfficial`, `updatedAt`),
  INDEX `Topic_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PostTopic` (
  `postId` VARCHAR(191) NOT NULL,
  `topicId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `PostTopic_topicId_createdAt_idx`(`topicId`, `createdAt`),
  PRIMARY KEY (`postId`, `topicId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Topic`
  ADD CONSTRAINT `Topic_activityId_fkey`
  FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Topic_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PostTopic`
  ADD CONSTRAINT `PostTopic_postId_fkey`
  FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PostTopic_topicId_fkey`
  FOREIGN KEY (`topicId`) REFERENCES `Topic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
