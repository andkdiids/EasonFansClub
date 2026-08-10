-- Support the YEAR leaderboard eligibility filter.
CREATE INDEX `GuessSongSession_year_leaderboard_idx`
  ON `GuessSongSession` (`status`, `isValid`, `mode`, `questionCount`, `completedAt`);
