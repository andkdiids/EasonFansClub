-- Add snapshot-based Badge validity and repeatable UserBadge history.
-- This file is intentionally not executed in this change; use the normal
-- deployment migration process when the database is ready.

ALTER TABLE `Badge`
    ADD COLUMN `validityType` ENUM('PERMANENT', 'DAYS') NOT NULL DEFAULT 'PERMANENT',
    ADD COLUMN `validityDays` INTEGER NULL;

ALTER TABLE `UserBadge`
    DROP INDEX `UserBadge_userId_badgeId_key`,
    ADD COLUMN `awardedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `expiredAt` DATETIME(3) NULL,
    ADD COLUMN `revokedAt` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `activeKey` VARCHAR(191) NULL,
    ADD COLUMN `grantKey` VARCHAR(191) NULL;

-- Existing UserBadge rows were unique per user/badge and therefore represent
-- the current historical grant. Keep every row active and permanently valid;
-- the new Badge default must never make an existing user lose a badge.
UPDATE `UserBadge`
SET
    `awardedAt` = COALESCE(`obtainedAt`, `grantedAt`, `createdAt`),
    `status` = 'ACTIVE',
    `activeKey` = SHA2(CONCAT('active:', `userId`, ':', `badgeId`), 256)
WHERE `activeKey` IS NULL;

CREATE UNIQUE INDEX `UserBadge_activeKey_key` ON `UserBadge`(`activeKey`);
CREATE UNIQUE INDEX `UserBadge_grantKey_key` ON `UserBadge`(`grantKey`);
CREATE INDEX `UserBadge_userId_status_expiresAt_idx` ON `UserBadge`(`userId`, `status`, `expiresAt`);
CREATE INDEX `UserBadge_userId_badgeId_status_idx` ON `UserBadge`(`userId`, `badgeId`, `status`);
CREATE INDEX `UserBadge_badgeId_status_idx` ON `UserBadge`(`badgeId`, `status`);
