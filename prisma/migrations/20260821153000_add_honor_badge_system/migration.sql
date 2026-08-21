-- E院勋章 / 荣誉系统：在既有 Badge/UserBadge 基础上补齐图鉴、佩戴、发放与昵称效果字段。
-- 本迁移只准备数据库变更；本轮不执行生产 migration。

ALTER TABLE `Badge`
    ADD COLUMN `code` VARCHAR(191) NULL,
    ADD COLUMN `acquisitionDescription` VARCHAR(500) NULL,
    ADD COLUMN `visibility` ENUM('PUBLIC', 'HIDDEN', 'SECRET') NOT NULL DEFAULT 'PUBLIC',
    ADD COLUMN `rarity` ENUM('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'LIMITED') NOT NULL DEFAULT 'COMMON',
    ADD COLUMN `grantType` ENUM('AUTO', 'MANUAL', 'EVENT') NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `isWearable` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `effectType` ENUM('NONE', 'SHINE', 'GLOW', 'SPARKLE') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `nicknameEffect` ENUM('NONE', 'COLOR', 'GOLD', 'GRADIENT', 'GLOW') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `nicknameColor` VARCHAR(20) NULL,
    ADD COLUMN `nicknameGradientStart` VARCHAR(20) NULL,
    ADD COLUMN `nicknameGradientEnd` VARCHAR(20) NULL,
    ADD COLUMN `sortOrder` INT NOT NULL DEFAULT 0;

UPDATE `Badge`
SET `code` = `slug`
WHERE `code` IS NULL;

ALTER TABLE `Badge`
    MODIFY COLUMN `code` VARCHAR(191) NOT NULL,
    ADD UNIQUE INDEX `Badge_code_key` (`code`),
    ADD INDEX `Badge_isEnabled_idx` (`isEnabled`),
    ADD INDEX `Badge_visibility_isEnabled_sortOrder_idx` (`visibility`, `isEnabled`, `sortOrder`),
    ADD INDEX `Badge_grantType_idx` (`grantType`),
    ADD INDEX `Badge_rarity_idx` (`rarity`);

ALTER TABLE `User`
    ADD COLUMN `equippedBadgeId` VARCHAR(191) NULL,
    ADD INDEX `User_equippedBadgeId_idx` (`equippedBadgeId`),
    ADD CONSTRAINT `User_equippedBadgeId_fkey`
      FOREIGN KEY (`equippedBadgeId`) REFERENCES `Badge`(`id`)
      ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `UserBadge`
    ADD COLUMN `obtainedAt` DATETIME(3) NULL,
    ADD COLUMN `sourceType` VARCHAR(32) NULL,
    ADD COLUMN `sourceId` VARCHAR(191) NULL,
    ADD COLUMN `grantReason` VARCHAR(500) NULL,
    ADD COLUMN `grantedBy` VARCHAR(191) NULL,
    ADD COLUMN `createdAt` DATETIME(3) NULL;

UPDATE `UserBadge`
SET `obtainedAt` = `grantedAt`,
    `createdAt` = `grantedAt`
WHERE `obtainedAt` IS NULL OR `createdAt` IS NULL;

ALTER TABLE `UserBadge`
    MODIFY COLUMN `obtainedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD INDEX `UserBadge_userId_obtainedAt_idx` (`userId`, `obtainedAt`),
    ADD INDEX `UserBadge_badgeId_idx` (`badgeId`),
    ADD INDEX `UserBadge_grantedBy_createdAt_idx` (`grantedBy`, `createdAt`),
    ADD CONSTRAINT `UserBadge_grantedBy_fkey`
      FOREIGN KEY (`grantedBy`) REFERENCES `User`(`id`)
      ON DELETE SET NULL ON UPDATE CASCADE;
