-- Add the long-term expert challenge while retaining ENDLESS for historical rows.
-- New application sessions use EASY / ADVANCED / HARD / EXPERT; legacy ENDLESS
-- sessions and leaderboard records remain readable and are mapped to EASY in code.

ALTER TABLE `GuessSongSession`
  MODIFY COLUMN `mode` ENUM('EASY', 'ADVANCED', 'HARD', 'EXPERT', 'ENDLESS') NOT NULL;

ALTER TABLE `GuessSongLeaderboardEntry`
  MODIFY COLUMN `mode` ENUM('EASY', 'ADVANCED', 'HARD', 'EXPERT', 'ENDLESS') NOT NULL;

ALTER TABLE `GuessSongQuizConfig`
  ADD COLUMN `expertEnabled` BOOLEAN NOT NULL DEFAULT true AFTER `enabled`;
