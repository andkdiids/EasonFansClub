-- E院勋章 Phase 2：系列、分级和限定收藏字段。
-- 仅增加可空/默认字段与新表；不删除或改写既有 Badge、UserBadge、佩戴关系。

CREATE TABLE `BadgeSeries` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BadgeSeries_code_key`(`code`),
    INDEX `BadgeSeries_isEnabled_sortOrder_idx`(`isEnabled`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- MySQL unique indexes allow multiple NULL values, so legacy ungrouped
-- badges can safely share the (NULL, NULL) tier pair.
ALTER TABLE `Badge`
    ADD COLUMN `seriesId` VARCHAR(191) NULL,
    ADD COLUMN `tierGroupCode` VARCHAR(64) NULL,
    ADD COLUMN `tierLevel` INT NULL,
    ADD COLUMN `availableFrom` DATETIME(3) NULL,
    ADD COLUMN `availableUntil` DATETIME(3) NULL,
    ADD UNIQUE INDEX `Badge_tierGroupCode_tierLevel_key` (`tierGroupCode`, `tierLevel`),
    ADD INDEX `Badge_seriesId_sortOrder_idx` (`seriesId`, `sortOrder`),
    ADD INDEX `Badge_availableFrom_availableUntil_idx` (`availableFrom`, `availableUntil`),
    ADD CONSTRAINT `Badge_seriesId_fkey`
      FOREIGN KEY (`seriesId`) REFERENCES `BadgeSeries`(`id`)
      ON DELETE SET NULL ON UPDATE CASCADE;
