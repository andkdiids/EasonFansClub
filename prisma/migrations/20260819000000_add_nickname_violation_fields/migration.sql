-- 昵称违规展示与处罚冷却
-- 设计见 AGENTS.md / 用户需求：违规昵称统一为「违规昵称」+ 8 位随机数字英文组合，且每个用户唯一；
-- 真实昵称保留在 nickname 字段，展示昵称由 nicknameViolationDisplay 提供；
-- 新增 nicknameViolationCount 支撑处罚冷却：0~1 次违规 = 30 天，2 次及以上 = 60 天（动态计算，无需落库字段）。

-- 1) 用户表新增违规展示昵称与违规计数（冷却时间由 nicknameViolationCount 动态计算，无需落库）
ALTER TABLE `User` ADD COLUMN `nicknameViolationDisplay` VARCHAR(32) NULL;
ALTER TABLE `User` ADD COLUMN `nicknameViolationCount` INT NOT NULL DEFAULT 0;
CREATE INDEX `User_nicknameViolationDisplay_idx` ON `User` (`nicknameViolationDisplay`);

-- 2) 新增昵称违规记录表（后台审核与处罚追溯）
CREATE TABLE `NicknameViolationLog` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `originalNickname` VARCHAR(32) NULL,
  `reason` VARCHAR(191) NULL,
  `violationGeneratedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `generatedDisplayName` VARCHAR(32) NOT NULL,
  `resolvedAt` DATETIME(3) NULL,
  `resolvedNickname` VARCHAR(32) NULL,
  `violationCount` INT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `NicknameViolationLog_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
