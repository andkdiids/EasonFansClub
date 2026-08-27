ALTER TABLE `SocialSyncLog`
  ADD COLUMN `notificationCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `baselineImport` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `SocialSyncState` (
  `id` VARCHAR(191) NOT NULL,
  `platform` ENUM('INSTAGRAM') NOT NULL DEFAULT 'INSTAGRAM',
  `target` VARCHAR(191) NOT NULL,
  `lastCheckedAt` DATETIME(3) NULL,
  `lastSuccessfulSyncAt` DATETIME(3) NULL,
  `lastChangedAt` DATETIME(3) NULL,
  `lastExternalId` VARCHAR(191) NULL,
  `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
  `nextAllowedSyncAt` DATETIME(3) NULL,
  `lastErrorCode` VARCHAR(64) NULL,
  `lastErrorAt` DATETIME(3) NULL,
  `baselineCompletedAt` DATETIME(3) NULL,
  `syncRequestedAt` DATETIME(3) NULL,
  `lockToken` VARCHAR(64) NULL,
  `lockUntil` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SocialSyncState_platform_target_key` (`platform`, `target`),
  INDEX `SocialSyncState_nextAllowedSyncAt_idx` (`nextAllowedSyncAt`),
  INDEX `SocialSyncState_lastSuccessfulSyncAt_idx` (`lastSuccessfulSyncAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
