-- Add a dedicated birthday greeting notification type so the system can send
-- a one-time-per-year birthday wish without reusing the generic SYSTEM type.
-- This only extends the existing ENUM column; no new table or column is added.
ALTER TABLE `Notification`
  MODIFY COLUMN `type` ENUM('REPLY', 'LIKE', 'SYSTEM', 'MESSAGE', 'ACTIVITY', 'ADMIN', 'FOLLOW', 'BADGE', 'FRIEND_REQUEST', 'BIRTHDAY_GREETING') NOT NULL;
