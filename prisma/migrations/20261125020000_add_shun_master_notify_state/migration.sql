-- Deferred Shun notification state machine.
--
-- Purely additive: every column is new and every historical round keeps its
-- already-delivered notification. `notifyStatus` defaults to SENT_PLAIN so old
-- rows are never re-queued, and only rounds created after this change start in
-- PENDING. No amount, ledger entry, capture result or notification is rewritten.
ALTER TABLE `ShunMasterRound`
    ADD COLUMN `notifyStatus` VARCHAR(16) NOT NULL DEFAULT 'SENT_PLAIN',
    ADD COLUMN `notifyDueAt` DATETIME(3) NULL,
    ADD COLUMN `notifiedAt` DATETIME(3) NULL,
    ADD COLUMN `notifyAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `notifyAuto` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `ShunMasterRound_notifyStatus_notifyDueAt_idx`
    ON `ShunMasterRound`(`notifyStatus`, `notifyDueAt`);
