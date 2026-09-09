-- Add a structured private message type for sharing posts between friends.
-- This migration is intentionally created but not executed in this task.
ALTER TABLE `DirectMessage`
  ADD COLUMN `metadata` JSON NULL;

ALTER TABLE `DirectMessage`
  MODIFY COLUMN `type` ENUM('TEXT', 'IMAGE', 'EMOJI', 'SYSTEM', 'STICKER', 'POST_SHARE') NOT NULL DEFAULT 'TEXT';
