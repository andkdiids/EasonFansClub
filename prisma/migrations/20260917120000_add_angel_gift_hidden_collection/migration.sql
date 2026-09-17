-- Angel Gift hidden members and per-theme collection reward configuration.
-- Additive only: no production data is changed and no reward is backfilled here.

ALTER TABLE `PharmacyCampaign`
    ADD COLUMN `collectionRewardBadgeId` VARCHAR(191) NULL,
    ADD INDEX `PharmacyCampaign_collectionRewardBadgeId_idx`(`collectionRewardBadgeId`),
    ADD CONSTRAINT `PharmacyCampaign_collectionRewardBadgeId_fkey`
      FOREIGN KEY (`collectionRewardBadgeId`) REFERENCES `Badge`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PharmacyPrize`
    ADD COLUMN `isHidden` BOOLEAN NOT NULL DEFAULT false;
