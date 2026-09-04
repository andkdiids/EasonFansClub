-- Prevent the same existing Badge from being configured twice in one theme.
-- MySQL permits multiple NULL values in a unique index, so a theme may still
-- contain any number of independent POINTS prizes (badgeId is NULL).
CREATE UNIQUE INDEX `PharmacyPrize_campaignId_badgeId_type_key`
    ON `PharmacyPrize`(`campaignId`, `badgeId`, `type`);
