-- Additive prerequisite for fencing; existing rows start at generation zero.
ALTER TABLE `SocialSyncState` ADD COLUMN `leaseGeneration` BIGINT NOT NULL DEFAULT 0;
