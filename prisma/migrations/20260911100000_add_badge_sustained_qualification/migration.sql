-- Additive lifecycle configuration for optional post-award qualification.
-- This migration intentionally does not alter or delete existing ownership history.
ALTER TABLE `BadgeRule`
    ADD COLUMN `sustainedQualification` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `inactiveAfterDays` INTEGER NULL,
    ADD COLUMN `revokeAfterDays` INTEGER NULL;

ALTER TABLE `UserBadge`
    ADD COLUMN `lastQualifiedAt` DATETIME(3) NULL;

-- GRAYED is a retained, temporarily inactive ownership state. Existing rows
-- keep their current ACTIVE/EXPIRED/REVOKED value through the enum expansion.
ALTER TABLE `UserBadge`
    MODIFY `status` ENUM('ACTIVE', 'GRAYED', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE';
