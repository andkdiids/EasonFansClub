-- 想听排行榜管理：管理员清除排行榜的操作日志表
-- 设计（审计安全）：
--   - adminId 外键 ON DELETE SET NULL（管理员被永久删除后不阻塞删除，日志不级联丢失）
--   - 保存管理员快照 adminUid / adminNickname / adminUsername，日志自包含、始终可追溯
--   - 只记录「谁在何时清除了哪个模式的多少条成绩」，不触碰游戏/用户/成就/反作弊数据
-- 本迁移只建文件，不自动应用到生产库。

CREATE TABLE `LeaderboardAdminLog` (
  `id` VARCHAR(191) NOT NULL,
  `adminId` VARCHAR(191) NULL,
  `action` VARCHAR(191) NOT NULL,
  `targetUserId` VARCHAR(191) NULL,
  `gameType` VARCHAR(191) NULL,
  `deletedCount` INT NOT NULL DEFAULT 0,
  `reason` VARCHAR(191) NULL,
  `adminUid` INT NULL,
  `adminNickname` VARCHAR(64) NULL,
  `adminUsername` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `LeaderboardAdminLog_adminId_createdAt_idx` (`adminId`, `createdAt`),
  INDEX `LeaderboardAdminLog_action_createdAt_idx` (`action`, `createdAt`),
  CONSTRAINT `LeaderboardAdminLog_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `LeaderboardAdminLog_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
