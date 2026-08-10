-- Allow administrators to exclude an EasMusic song from expert-mode questions.
-- Existing rows remain intact and receive the default value true.
ALTER TABLE `MusicSong`
  ADD COLUMN `expertEnabled` BOOLEAN NOT NULL DEFAULT true AFTER `description`;
