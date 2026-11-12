ALTER TABLE `WantListenSession`
ADD COLUMN `excludedFromLeaderboard` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `WantListenSession_excludedFromLeaderboard_status_completedAt_idx`
ON `WantListenSession` (`excludedFromLeaderboard`, `status`, `completedAt`);
