-- Persist the final reward decision separately from the game result. The
-- PointLog.businessKey below is the database-level idempotency key for one
-- reward per Match; this migration only adds the Match-side snapshot fields.

ALTER TABLE `GuessSongDuelMatch`
  ADD COLUMN `rewardGranted` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `rewardReason` ENUM(
    'NOT_APPLICABLE',
    'PENDING',
    'GRANTED',
    'DAILY_LIMIT_REACHED',
    'ALREADY_GRANTED_FOR_MATCH',
    'REWARD_FAILED',
    'NOT_ELIGIBLE'
  ) NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN `rewardedAt` DATETIME(3) NULL;

CREATE INDEX `GuessSongDuelMatch_rewardReason_finishedAt_idx`
  ON `GuessSongDuelMatch` (`rewardReason`, `finishedAt`);

CREATE INDEX `PointLog_userId_action_dateKey_idx`
  ON `PointLog` (`userId`, `action`, `dateKey`);
