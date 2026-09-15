-- Add a structured private message type for sharing material redemption items.
-- This migration is intentionally created but not executed in this task.
ALTER TABLE `DirectMessage`
  MODIFY COLUMN `type` ENUM('TEXT', 'IMAGE', 'EMOJI', 'SYSTEM', 'STICKER', 'POST_SHARE', 'MATERIAL_SHARE') NOT NULL DEFAULT 'TEXT';
