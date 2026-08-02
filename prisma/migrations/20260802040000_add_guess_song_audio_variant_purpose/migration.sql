-- Add the registration-only purpose discriminator without removing existing audio records.
-- Existing rows are backfilled as GAME by the column default.

ALTER TABLE `GuessSongAudioVariant`
  ADD COLUMN `purpose` ENUM('GAME', 'REGISTER_CHECK') NOT NULL DEFAULT 'GAME';

DROP INDEX `GuessSongAudioVariant_questionId_durationSeconds_key`
  ON `GuessSongAudioVariant`;

CREATE UNIQUE INDEX `GuessSongAudioVariant_questionId_durationSeconds_purpose_key`
  ON `GuessSongAudioVariant`(`questionId`, `durationSeconds`, `purpose`);

CREATE INDEX `GuessSongAudioVariant_questionId_purpose_idx`
  ON `GuessSongAudioVariant`(`questionId`, `purpose`);
