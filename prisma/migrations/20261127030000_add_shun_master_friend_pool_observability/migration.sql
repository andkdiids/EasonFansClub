-- Shun master friend-pool observability.
--
-- The friend pool was historically abandoned silently when it held nobody, which
-- made "friendChance=100 still drew strangers" impossible to diagnose from data.
-- Every round now records how large the friend pool was and why (if) it fell
-- back to the global pool. Purely additive columns; existing rows stay at 0/NULL.
ALTER TABLE `ShunMasterRound` ADD COLUMN `friendPoolSize` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `ShunMasterRound` ADD COLUMN `friendPoolFallback` VARCHAR(32) NULL;
