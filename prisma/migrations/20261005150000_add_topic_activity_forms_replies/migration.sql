ALTER TABLE `Activity`
  ADD COLUMN `participationMode` ENUM('COMMENT', 'FORM', 'BOTH') NOT NULL DEFAULT 'COMMENT',
  ADD COLUMN `allowImageAttachments` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `formSchema` JSON NULL;

CREATE TABLE `TopicActivityFormSubmission` (
  `id` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `formSchemaSnapshot` JSON NOT NULL,
  `answersSnapshot` JSON NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedAt` DATETIME(3) NULL,
  `reviewedById` VARCHAR(191) NULL,
  `rejectReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `TopicActivityFormSubmission_activityId_status_submittedAt_idx` (`activityId`, `status`, `submittedAt`),
  INDEX `TopicActivityFormSubmission_userId_activityId_status_idx` (`userId`, `activityId`, `status`),
  INDEX `TopicActivityFormSubmission_reviewedById_reviewedAt_idx` (`reviewedById`, `reviewedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TopicActivityFormSubmission_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityFormSubmission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityFormSubmission_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TopicActivityFormReviewLog` (
  `id` VARCHAR(191) NOT NULL,
  `submissionId` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `fromStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL,
  `toStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL,
  `reviewedById` VARCHAR(191) NULL,
  `reason` TEXT NULL,
  `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `TopicActivityFormReviewLog_submissionId_reviewedAt_idx` (`submissionId`, `reviewedAt`),
  INDEX `TopicActivityFormReviewLog_activityId_reviewedAt_idx` (`activityId`, `reviewedAt`),
  INDEX `TopicActivityFormReviewLog_userId_reviewedAt_idx` (`userId`, `reviewedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TopicActivityFormReviewLog_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `TopicActivityFormSubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityFormReviewLog_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityFormReviewLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityFormReviewLog_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TopicActivitySubmissionReply` (
  `id` VARCHAR(191) NOT NULL,
  `submissionId` VARCHAR(191) NOT NULL,
  `senderUserId` VARCHAR(191) NOT NULL,
  `senderRole` ENUM('ADMIN') NOT NULL DEFAULT 'ADMIN',
  `content` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `TopicActivitySubmissionReply_submissionId_createdAt_id_idx` (`submissionId`, `createdAt`, `id`),
  INDEX `TopicActivitySubmissionReply_senderUserId_createdAt_idx` (`senderUserId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TopicActivitySubmissionReply_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `TopicActivityFormSubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivitySubmissionReply_senderUserId_fkey` FOREIGN KEY (`senderUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TopicActivityImageAsset` (
  `id` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `uploadedByUserId` VARCHAR(191) NOT NULL,
  `purpose` ENUM('FORM_ANSWER', 'ADMIN_REPLY') NOT NULL,
  `storageKey` VARCHAR(500) NOT NULL,
  `mimeType` VARCHAR(80) NOT NULL,
  `width` INTEGER NOT NULL,
  `height` INTEGER NOT NULL,
  `size` INTEGER NOT NULL,
  `formSubmissionId` VARCHAR(191) NULL,
  `replyId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TopicActivityImageAsset_storageKey_key` (`storageKey`),
  INDEX `TopicActivityImageAsset_activityId_purpose_createdAt_idx` (`activityId`, `purpose`, `createdAt`),
  INDEX `TopicActivityImageAsset_uploadedByUserId_activityId_purpose_idx` (`uploadedByUserId`, `activityId`, `purpose`),
  INDEX `TopicActivityImageAsset_formSubmissionId_idx` (`formSubmissionId`),
  INDEX `TopicActivityImageAsset_replyId_idx` (`replyId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TopicActivityImageAsset_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityImageAsset_uploadedByUserId_fkey` FOREIGN KEY (`uploadedByUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityImageAsset_formSubmissionId_fkey` FOREIGN KEY (`formSubmissionId`) REFERENCES `TopicActivityFormSubmission`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityImageAsset_replyId_fkey` FOREIGN KEY (`replyId`) REFERENCES `TopicActivitySubmissionReply`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
