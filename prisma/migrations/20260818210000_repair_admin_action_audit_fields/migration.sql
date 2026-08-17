-- Repair AdminAction schema drift on production.
--
-- The current prisma/schema.prisma extends AdminAction with audit fields
-- (operatorName, operatorUsername, operatorUid, operationType, targetType,
-- targetId, targetTitle, targetUserName, targetUserUid, result) and relaxes
-- adminId from NOT NULL to nullable with ON DELETE SET NULL. Those changes
-- were introduced after 20260804120000_add_home_phase_one but never shipped
-- as a migration, so `prisma migrate status` reports up to date while the real
-- database still lacks the columns. Writes such as `recordAdminAction` then
-- fail with Prisma error P2022 ("column ... does not exist").
--
-- This migration brings the live table up to the schema without touching
-- existing rows, indexes, or other tables. All added columns are nullable and
-- `result` defaults existing rows to 'SUCCESS'.
--
-- Safety notes:
--   * No DROP TABLE / TRUNCATE / DELETE.
--   * adminId goes NOT NULL -> NULL (a constraint relaxation, never loses data).
--   * The FK is dropped and recreated with the same name so the column can
--     become nullable, then switches to ON DELETE SET NULL / ON UPDATE CASCADE.

-- 1) Drop the existing FK so adminId can be relaxed to nullable.
ALTER TABLE `AdminAction`
  DROP FOREIGN KEY `AdminAction_adminId_fkey`;

-- 2) Relax adminId to nullable.
ALTER TABLE `AdminAction`
  MODIFY COLUMN `adminId` VARCHAR(191) NULL;

-- 3) Add the missing audit columns (nullable; result defaults to 'SUCCESS').
ALTER TABLE `AdminAction`
  ADD COLUMN `operatorName` VARCHAR(191) NULL,
  ADD COLUMN `operatorUsername` VARCHAR(191) NULL,
  ADD COLUMN `operatorUid` INTEGER NULL,
  ADD COLUMN `operationType` VARCHAR(191) NULL,
  ADD COLUMN `targetType` VARCHAR(191) NULL,
  ADD COLUMN `targetId` VARCHAR(191) NULL,
  ADD COLUMN `targetTitle` VARCHAR(191) NULL,
  ADD COLUMN `targetUserName` VARCHAR(191) NULL,
  ADD COLUMN `targetUserUid` INTEGER NULL,
  ADD COLUMN `result` VARCHAR(191) NULL DEFAULT 'SUCCESS';

-- 4) Recreate the FK with the relaxed delete behaviour and a cascade update.
ALTER TABLE `AdminAction`
  ADD CONSTRAINT `AdminAction_adminId_fkey`
  FOREIGN KEY (`adminId`) REFERENCES `User` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) Add the composite indexes the schema requires but production lacks.
--    Indexes already present on production (action, adminId+createdAt, boardId,
--    postId, replyId, targetUserId) are intentionally NOT recreated.
CREATE INDEX `AdminAction_operationType_createdAt_idx`
  ON `AdminAction` (`operationType`, `createdAt`);

CREATE INDEX `AdminAction_operatorUid_createdAt_idx`
  ON `AdminAction` (`operatorUid`, `createdAt`);

CREATE INDEX `AdminAction_targetType_createdAt_idx`
  ON `AdminAction` (`targetType`, `createdAt`);

CREATE INDEX `AdminAction_targetId_createdAt_idx`
  ON `AdminAction` (`targetId`, `createdAt`);
