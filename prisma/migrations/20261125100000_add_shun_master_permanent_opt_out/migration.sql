-- Permanent opt-out of Shun Master.
--
-- Purely additive and irreversible by design: the column defaults to NULL, so
-- every existing user keeps participating exactly as before. Nothing in the
-- history (rounds, ledger, letters, notifications, captures) is touched. Once
-- a timestamp is set, no ordinary API clears it.
ALTER TABLE `User`
    ADD COLUMN `permanentlyOptedOutAt` DATETIME(3) NULL;

CREATE INDEX `User_permanentlyOptedOutAt_idx`
    ON `User`(`permanentlyOptedOutAt`);
