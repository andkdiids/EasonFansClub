-- Add automatic historical events while preserving manual source references.
ALTER TABLE `TodayEvent`
  ADD COLUMN `reference` VARCHAR(191) NULL AFTER `source`;

UPDATE `TodayEvent`
SET `reference` = `source`
WHERE `source` IS NOT NULL;

UPDATE `TodayEvent`
SET `source` = 'ADMIN';

ALTER TABLE `TodayEvent`
  MODIFY COLUMN `source` ENUM('AUTO', 'ADMIN') NOT NULL DEFAULT 'ADMIN',
  MODIFY COLUMN `type` ENUM(
    'ALBUM', 'CONCERT', 'SONG', 'CAREER', 'AWARD', 'CUSTOM',
    'BIRTHDAY', 'DEBUT', 'ROOKIE_CONTEST', 'ALBUM_RELEASE', 'OTHER'
  ) NOT NULL;
