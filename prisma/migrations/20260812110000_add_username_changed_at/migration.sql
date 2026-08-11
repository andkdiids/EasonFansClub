ALTER TABLE `User`
  ADD COLUMN `usernameChangedAt` DATETIME(3) NULL AFTER `usernameNormalized`;
