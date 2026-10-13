-- Phase C/D: checked COPY validates ALL committed associations under the DDL
-- lock. Requires a separately approved bounded maintenance window/write fence.
-- Five-second MDL budget is not a total COPY deadline. The deployment gate must
-- authorize the total budget/cancellation/recovery evidence before running.
-- Failure preserves previous stages: do not automatically retry/resolve them.
SET SESSION foreign_key_checks = 1;
SET SESSION lock_wait_timeout = 5;
ALTER TABLE `LotteryEntry` ADD CONSTRAINT `TopicLotteryWinner_slot_fk` FOREIGN KEY (`topicSlotId`) REFERENCES `TopicActivityLotterySlot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE, ALGORITHM=COPY, LOCK=SHARED;
