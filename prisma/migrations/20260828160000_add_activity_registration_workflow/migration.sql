-- Activity registration workflow: custom questions, cancellable registrations,
-- staff verification and post-verification badge rewards.
-- This migration is intentionally incremental and does not rewrite existing
-- registration rows or execute any production database operation.

ALTER TABLE `Activity`
  ADD COLUMN `verificationMode` ENUM('NONE', 'MANUAL', 'QR') NOT NULL DEFAULT 'NONE';

ALTER TABLE `ActivityRegistration`
  ADD COLUMN `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN `verifiedAt` DATETIME(3) NULL,
  ADD COLUMN `verifiedById` VARCHAR(191) NULL,
  ADD COLUMN `verificationMethod` ENUM('MANUAL', 'QR') NULL,
  ADD COLUMN `verificationToken` VARCHAR(128) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD UNIQUE INDEX `ActivityRegistration_verificationToken_key` (`verificationToken`),
  ADD INDEX `ActivityRegistration_activityId_status_idx` (`activityId`, `status`),
  ADD INDEX `ActivityRegistration_userId_registeredAt_idx` (`userId`, `registeredAt`),
  ADD INDEX `ActivityRegistration_verifiedById_verifiedAt_idx` (`verifiedById`, `verifiedAt`),
  ADD CONSTRAINT `ActivityRegistration_verifiedById_fkey`
    FOREIGN KEY (`verifiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `ActivityRegistrationQuestion` (
  `id` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(300) NOT NULL,
  `type` ENUM('TEXT', 'TEXTAREA', 'SINGLE_SELECT', 'MULTI_SELECT', 'NUMBER', 'PHONE', 'SELECT') NOT NULL,
  `required` BOOLEAN NOT NULL DEFAULT false,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `placeholder` VARCHAR(300) NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ActivityRegistrationQuestion_activityId_sortOrder_id_idx` (`activityId`, `sortOrder`, `id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ActivityRegistrationQuestion_activityId_fkey`
    FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ActivityRegistrationQuestionOption` (
  `id` VARCHAR(191) NOT NULL,
  `questionId` VARCHAR(191) NOT NULL,
  `label` VARCHAR(300) NOT NULL,
  `value` VARCHAR(300) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ActivityRegistrationQuestionOption_questionId_value_key` (`questionId`, `value`),
  INDEX `ActivityRegistrationQuestionOption_questionId_sortOrder_id_idx` (`questionId`, `sortOrder`, `id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ActivityRegistrationQuestionOption_questionId_fkey`
    FOREIGN KEY (`questionId`) REFERENCES `ActivityRegistrationQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ActivityRegistrationAnswer` (
  `id` VARCHAR(191) NOT NULL,
  `registrationId` VARCHAR(191) NOT NULL,
  `questionId` VARCHAR(191) NOT NULL,
  `questionTitle` VARCHAR(300) NOT NULL,
  `value` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ActivityRegistrationAnswer_registrationId_questionId_key` (`registrationId`, `questionId`),
  INDEX `ActivityRegistrationAnswer_questionId_idx` (`questionId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ActivityRegistrationAnswer_registrationId_fkey`
    FOREIGN KEY (`registrationId`) REFERENCES `ActivityRegistration`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ActivityRegistrationAnswer_questionId_fkey`
    FOREIGN KEY (`questionId`) REFERENCES `ActivityRegistrationQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ActivityReward` (
  `id` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `type` ENUM('BADGE') NOT NULL,
  `badgeId` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ActivityReward_activityId_type_key` (`activityId`, `type`),
  INDEX `ActivityReward_badgeId_idx` (`badgeId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ActivityReward_activityId_fkey`
    FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ActivityReward_badgeId_fkey`
    FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
