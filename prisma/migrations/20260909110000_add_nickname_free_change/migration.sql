-- One long-lived self-service nickname opportunity per user.
-- NULL means available. This migration intentionally does not rewrite
-- nicknameChangedAt or execute any production data update.
ALTER TABLE `User`
    ADD COLUMN `nicknameFreeChangeUsedAt` DATETIME(3) NULL;
