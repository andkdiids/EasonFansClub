-- Phase B2: unique slot allocation. LOCK=NONE is not a promise of zero MDL/IO.
-- Unsupported algorithms or duplicates fail closed; never retry as COPY.
SET SESSION foreign_key_checks = 1;
SET SESSION lock_wait_timeout = 5;
ALTER TABLE `LotteryEntry` ADD UNIQUE INDEX `TopicLotteryWinner_slot_key` (`topicSlotId`), ALGORITHM=INPLACE, LOCK=NONE;
