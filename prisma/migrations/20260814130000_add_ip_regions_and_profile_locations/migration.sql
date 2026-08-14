ALTER TABLE `CultureComment`
  ADD COLUMN `ipRegion` VARCHAR(191) NULL;

ALTER TABLE `DailyMessage`
  ADD COLUMN `ipRegion` VARCHAR(191) NULL;

ALTER TABLE `DailyMessageComment`
  ADD COLUMN `ipRegion` VARCHAR(191) NULL;

ALTER TABLE `Profile`
  ADD COLUMN `locationCountryCode` VARCHAR(191) NULL,
  ADD COLUMN `locationCountry` VARCHAR(191) NULL,
  ADD COLUMN `locationRegionCode` VARCHAR(191) NULL,
  ADD COLUMN `locationRegion` VARCHAR(191) NULL;

ALTER TABLE `ProfileWallMessage`
  ADD COLUMN `ipRegion` VARCHAR(191) NULL;

ALTER TABLE `Reply`
  ADD COLUMN `ipRegion` VARCHAR(191) NULL;

ALTER TABLE `User`
  ADD COLUMN `ipRegion` VARCHAR(191) NULL,
  ADD COLUMN `ipRegionUpdatedAt` DATETIME(3) NULL;
