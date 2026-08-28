-- Notification readAt is the single persisted read-state authority.
-- Keep isRead synchronized for legacy readers while existing data is aligned.
UPDATE `Notification`
SET `readAt` = COALESCE(`readAt`, `createdAt`)
WHERE `isRead` = true AND `readAt` IS NULL;

UPDATE `Notification`
SET `isRead` = CASE WHEN `readAt` IS NULL THEN false ELSE true END;

CREATE INDEX `Notification_recipientId_readAt_createdAt_idx`
  ON `Notification`(`recipientId`, `readAt`, `createdAt`);
