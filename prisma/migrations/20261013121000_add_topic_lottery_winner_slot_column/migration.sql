-- Phase B1: a compatible nullable column, with no silent INPLACE/COPY fallback.
-- Old winners retain NULL. Do not guess or backfill historical allocations.
SET SESSION foreign_key_checks = 1;
SET SESSION lock_wait_timeout = 5;
ALTER TABLE `LotteryEntry` ADD COLUMN `topicSlotId` VARCHAR(191) NULL, ALGORITHM=INSTANT;
