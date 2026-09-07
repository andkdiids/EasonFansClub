-- Historical users intentionally default to zero: the first post-set self edit
-- remains available unless there is an explicit existing record proving it was used.
ALTER TABLE `User`
  ADD COLUMN `birthdateSelfEditCount` INT NOT NULL DEFAULT 0;
