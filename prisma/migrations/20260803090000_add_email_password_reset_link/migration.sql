-- Isolate one-time email reset links from the existing security-question and email-code flows.
ALTER TABLE `PasswordResetToken`
  MODIFY COLUMN `type` ENUM('SECURITY_QUESTION', 'EMAIL', 'EMAIL_LINK') NOT NULL DEFAULT 'EMAIL';

CREATE INDEX `PasswordResetToken_type_stage_expiresAt_idx`
  ON `PasswordResetToken`(`type`, `stage`, `expiresAt`);
