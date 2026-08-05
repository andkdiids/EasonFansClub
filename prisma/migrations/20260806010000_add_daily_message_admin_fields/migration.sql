-- AlterTable
ALTER TABLE `DailyMessage`
  ADD COLUMN `moderationStatus` ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN `sort` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `isAdminMessage` BOOLEAN NOT NULL DEFAULT FALSE;

-- CreateIndex
CREATE INDEX `DailyMessage_date_isAdminMessage_sort_createdAt_idx` ON `DailyMessage` (`date`, `isAdminMessage`, `sort`, `createdAt`);
