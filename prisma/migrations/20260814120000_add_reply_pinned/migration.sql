ALTER TABLE `Reply`
  ADD COLUMN `isPinned` BOOLEAN NOT NULL DEFAULT false AFTER `isDeleted`;

CREATE INDEX `Reply_postId_isDeleted_isPinned_idx`
  ON `Reply` (`postId`, `isDeleted`, `isPinned`);
