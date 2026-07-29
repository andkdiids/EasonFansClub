-- Preserve all existing songs and guessing questions while adding an optional
-- private audio-source reference and source revision metadata.
ALTER TABLE `MusicSong`
  ADD COLUMN `sourceAudioPath` VARCHAR(191) NULL,
  ADD COLUMN `sourceAudioDurationMs` INTEGER NULL,
  ADD COLUMN `sourceAudioRevision` VARCHAR(191) NULL;

ALTER TABLE `GuessSongQuestion`
  ADD COLUMN `audioSourceType` VARCHAR(191) NULL,
  ADD COLUMN `musicSourceRevision` VARCHAR(191) NULL;
