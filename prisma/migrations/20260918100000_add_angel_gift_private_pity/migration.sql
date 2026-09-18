-- Angel's Gift private pity configuration and per-user state.
-- Additive only: disabled by default and contains no production data operation.

ALTER TABLE `PharmacyCampaign`
    ADD COLUMN `pityEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pityThreshold` INTEGER NULL,
    ADD COLUMN `pityIncludeHidden` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `PharmacyDraw`
    ADD COLUMN `isPity` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `PharmacyUserCampaignState` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `pityCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `PharmacyUserCampaignState_userId_campaignId_key`(`userId`, `campaignId`),
    INDEX `PharmacyUserCampaignState_campaignId_idx`(`campaignId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PharmacyUserCampaignState`
    ADD CONSTRAINT `PharmacyUserCampaignState_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `PharmacyUserCampaignState_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `PharmacyCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
