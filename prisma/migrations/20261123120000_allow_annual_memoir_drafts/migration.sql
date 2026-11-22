-- Reserve each published year's slot before dropping the legacy year-wide restriction.
ALTER TABLE `AnnualMemoirConfig`
    ADD COLUMN `publishedYear` INTEGER NULL,
    ADD UNIQUE INDEX `AnnualMemoirConfig_publishedYear_key` (`publishedYear`),
    ADD INDEX `AnnualMemoirConfig_year_idx` (`year`);

UPDATE `AnnualMemoirConfig` AS config
JOIN `Activity` AS activity ON activity.`id` = config.`activityId`
SET config.`publishedYear` = config.`year`
WHERE activity.`status` = 'PUBLISHED';

ALTER TABLE `AnnualMemoirConfig` DROP INDEX `AnnualMemoirConfig_year_key`;
