-- Add a recoverable paused state without changing existing session rows or score data.
ALTER TABLE `GuessSongSession`
  MODIFY COLUMN `status` ENUM('IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ABANDONED', 'EXPIRED', 'CHEAT_DETECTED') NOT NULL DEFAULT 'IN_PROGRESS';
