-- Temporarily include both old and new values so existing rows can be normalized safely.
ALTER TABLE `Activity`
  MODIFY COLUMN `type` ENUM('CONCERT_SIGNUP', 'GATHERING', 'ONLINE', 'LOTTERY', 'OFFLINE', 'CONCERT', 'COMMUNITY', 'BENEFIT', 'OTHER') NOT NULL DEFAULT 'OTHER',
  MODIFY COLUMN `status` ENUM('DRAFT', 'PUBLISHED', 'CLOSED', 'FINISHED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

-- Normalize the legacy activity values before tightening the enums.
UPDATE `Activity` SET `type` = 'CONCERT' WHERE `type` = 'CONCERT_SIGNUP';
UPDATE `Activity` SET `type` = 'OFFLINE' WHERE `type` = 'GATHERING';
UPDATE `Activity` SET `type` = 'BENEFIT' WHERE `type` = 'LOTTERY';
UPDATE `Activity` SET `status` = 'PUBLISHED' WHERE `status` IN ('CLOSED', 'FINISHED');

ALTER TABLE `Activity`
  MODIFY COLUMN `description` TEXT NOT NULL,
  MODIFY COLUMN `type` ENUM('OFFLINE', 'ONLINE', 'CONCERT', 'COMMUNITY', 'BENEFIT', 'OTHER') NOT NULL DEFAULT 'OTHER',
  MODIFY COLUMN `status` ENUM('DRAFT', 'PUBLISHED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `Activity`
  ADD COLUMN `subtitle` VARCHAR(300) NULL,
  ADD COLUMN `bannerUrl` VARCHAR(191) NULL,
  ADD COLUMN `locationName` VARCHAR(300) NULL,
  ADD COLUMN `locationAddress` VARCHAR(500) NULL,
  ADD COLUMN `onlineUrl` VARCHAR(500) NULL,
  ADD COLUMN `registrationStartAt` DATETIME(3) NULL,
  ADD COLUMN `registrationEndAt` DATETIME(3) NULL,
  ADD COLUMN `organizer` VARCHAR(160) NULL,
  ADD COLUMN `contactInfo` VARCHAR(500) NULL,
  ADD COLUMN `isFeatured` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `isPinned` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `viewCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `publishedAt` DATETIME(3) NULL,
  ADD COLUMN `createdById` VARCHAR(191) NULL,
  ADD COLUMN `updatedById` VARCHAR(191) NULL;

UPDATE `Activity` SET `publishedAt` = `createdAt` WHERE `status` = 'PUBLISHED' AND `publishedAt` IS NULL;

CREATE INDEX `Activity_isPinned_sortOrder_startsAt_idx` ON `Activity`(`isPinned`, `sortOrder`, `startsAt`);
CREATE INDEX `Activity_isFeatured_idx` ON `Activity`(`isFeatured`);
CREATE INDEX `Activity_publishedAt_idx` ON `Activity`(`publishedAt`);
CREATE INDEX `Activity_createdById_idx` ON `Activity`(`createdById`);
CREATE INDEX `Activity_updatedById_idx` ON `Activity`(`updatedById`);

ALTER TABLE `Activity`
  ADD CONSTRAINT `Activity_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Activity_updatedById_fkey`
    FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
