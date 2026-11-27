CREATE INDEX `GrowthTaskCompletion_shun_scan_idx` ON `GrowthTaskCompletion`(`createdAt`, `id`);
CREATE INDEX `DirectMessage_shun_share_scan_idx` ON `DirectMessage`(`type`, `createdAt`, `id`);

CREATE TABLE `ShunItemRewardEvent` (
  `sourceType` VARCHAR(16) NOT NULL,
  `sourceId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `day` CHAR(10) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `occurrenceKey` VARCHAR(191) NULL,
  `configVersion` INTEGER NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `dropRoll` INTEGER NOT NULL,
  `itemRoll` INTEGER NOT NULL,
  `mainRoll` INTEGER NOT NULL,
  `weeklyRolls` JSON NOT NULL,
  `processedAt` DATETIME(3) NULL,
  `retryAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `attempts` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`sourceType`, `sourceId`),
  INDEX `ShunItemRewardEvent_processedAt_retryAt_idx` (`processedAt`, `retryAt`),
  INDEX `ShunItemRewardEvent_dedupe_idx` (`userId`, `kind`, `occurrenceKey`, `processedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
