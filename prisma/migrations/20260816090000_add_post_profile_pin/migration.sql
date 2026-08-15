ALTER TABLE `Post`
  ADD COLUMN `profilePinnedAt` DATETIME(3) NULL;

CREATE INDEX `Post_authorId_profilePinnedAt_createdAt_idx`
  ON `Post` (`authorId`, `profilePinnedAt`, `createdAt`);
