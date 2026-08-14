-- Split the shared Guess Song Duel room into two locked rule sets.
-- Existing rooms and matches default to SCORE so historical data keeps its
-- original simultaneous-answer semantics.

ALTER TABLE `GuessSongDuelRoom`
  ADD COLUMN `mode` ENUM('SCORE', 'BUZZER') NOT NULL DEFAULT 'SCORE';

ALTER TABLE `GuessSongDuelMatch`
  ADD COLUMN `mode` ENUM('SCORE', 'BUZZER') NOT NULL DEFAULT 'SCORE',
  MODIFY COLUMN `finishReason` ENUM('SCORE_THRESHOLD', 'ALL_QUESTIONS', 'TIEBREAKER', 'DISCONNECT', 'FORFEIT', 'DISCONNECT_INVALID', 'FORFEIT_INVALID') NULL;

ALTER TABLE `GuessSongDuelQuestion`
  ADD COLUMN `isOvertime` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `overtimeIndex` INTEGER NULL;
