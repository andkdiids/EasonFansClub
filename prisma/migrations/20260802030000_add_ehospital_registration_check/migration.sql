-- Create the registration-only E院体检 tables.
-- This migration intentionally does not alter any existing table.

CREATE TABLE `EHospitalCheckConfig` (
  `id` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `questionCount` INTEGER NOT NULL DEFAULT 10,
  `audioSeconds` INTEGER NOT NULL DEFAULT 7,
  `passScore` INTEGER NOT NULL DEFAULT 60,
  `dailyLimit` INTEGER NOT NULL DEFAULT 3,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RegistrationDraft` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `registrationType` VARCHAR(191) NOT NULL,
  `username` VARCHAR(191) NOT NULL,
  `usernameNormalized` VARCHAR(191) NOT NULL,
  `nickname` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(191) NOT NULL,
  `passwordHash` VARCHAR(191) NOT NULL,
  `securityQuestions` JSON NULL,
  `acceptedAgreement` BOOLEAN NOT NULL DEFAULT false,
  `identityHash` VARCHAR(191) NOT NULL,
  `phoneCodeHash` VARCHAR(191) NULL,
  `phoneCodeExpiresAt` DATETIME(3) NULL,
  `phoneVerifiedAt` DATETIME(3) NULL,
  `emailCodeHash` VARCHAR(191) NULL,
  `emailCodeExpiresAt` DATETIME(3) NULL,
  `emailVerifiedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RegistrationDraft_tokenHash_key`(`tokenHash`),
  INDEX `RegistrationDraft_email_idx`(`email`),
  INDEX `RegistrationDraft_phone_idx`(`phone`),
  INDEX `RegistrationDraft_identityHash_createdAt_idx`(`identityHash`, `createdAt`),
  INDEX `RegistrationDraft_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EHospitalCheckSession` (
  `id` VARCHAR(191) NOT NULL,
  `questions` JSON NOT NULL,
  `answers` JSON NULL,
  `score` INTEGER NULL,
  `status` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `registrationDraftId` VARCHAR(191) NOT NULL,
  INDEX `EHospitalCheckSession_registrationDraftId_status_createdAt_idx`(`registrationDraftId`, `status`, `createdAt`),
  INDEX `EHospitalCheckSession_status_expiresAt_idx`(`status`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EHospitalCheckAttempt` (
  `id` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(191) NOT NULL,
  `score` INTEGER NOT NULL,
  `passed` BOOLEAN NOT NULL,
  `ip` VARCHAR(191) NULL,
  `identityHash` VARCHAR(191) NULL,
  `userId` VARCHAR(191) NULL,
  `registrationDraftId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `EHospitalCheckAttempt_sessionId_key`(`sessionId`),
  INDEX `EHospitalCheckAttempt_identityHash_createdAt_idx`(`identityHash`, `createdAt`),
  INDEX `EHospitalCheckAttempt_registrationDraftId_createdAt_idx`(`registrationDraftId`, `createdAt`),
  INDEX `EHospitalCheckAttempt_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EHospitalCheckSession`
  ADD CONSTRAINT `EHospitalCheckSession_registrationDraftId_fkey`
  FOREIGN KEY (`registrationDraftId`) REFERENCES `RegistrationDraft`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `EHospitalCheckAttempt`
  ADD CONSTRAINT `EHospitalCheckAttempt_sessionId_fkey`
  FOREIGN KEY (`sessionId`) REFERENCES `EHospitalCheckSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `EHospitalCheckAttempt_registrationDraftId_fkey`
  FOREIGN KEY (`registrationDraftId`) REFERENCES `RegistrationDraft`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `EHospitalCheckAttempt_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
