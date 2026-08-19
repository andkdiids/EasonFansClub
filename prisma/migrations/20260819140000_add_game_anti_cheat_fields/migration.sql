-- 娱乐天空反作弊加固（想听/粤语残片/防不胜防 + 统一反作弊日志）
-- 设计见 AGENTS.md / 用户需求：
--   1) want-listen 三模式改为服务端随机选项 key（消除答案提前泄露）
--   2) 单题服务端计时（questionStartedAt / answerLatencyMs），不信任客户端时间
--   3) 会话 antiCheatStatus = CLEAN 才允许进排行榜
--   4) 统一 GameAntiCheatLog 记录 FAST_ANSWER / REPEATED_SUBMIT 等异常
-- 本迁移只建文件，不自动应用到生产库。

-- 1) 想听/粤语残片/防不胜防 会话新增反作弊状态与审计字段
ALTER TABLE `WantListenSession`
  ADD COLUMN `antiCheatStatus` VARCHAR(191) NOT NULL DEFAULT 'CLEAN',
  ADD COLUMN `antiCheatReasons` JSON NULL,
  ADD COLUMN `ipAddress` VARCHAR(191) NULL,
  ADD COLUMN `userAgent` VARCHAR(191) NULL;
CREATE INDEX `WantListenSession_antiCheatStatus_status_completedAt_idx`
  ON `WantListenSession` (`antiCheatStatus`, `status`, `completedAt`);

-- 2) 单题服务端计时（答题耗时完全由服务端计算）
ALTER TABLE `WantListenSessionQuestion`
  ADD COLUMN `questionStartedAt` DATETIME(3) NULL,
  ADD COLUMN `answerLatencyMs` INT NULL;
CREATE INDEX `WantListenSessionQuestion_sessionId_questionStartedAt_idx`
  ON `WantListenSessionQuestion` (`sessionId`, `questionStartedAt`);

-- 3) 统一反作弊日志表
CREATE TABLE `GameAntiCheatLog` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `gameType` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(191) NULL,
  `questionCount` INT NULL,
  `fastestAnswerTime` INT NULL,
  `averageAnswerTime` INT NULL,
  `ip` VARCHAR(191) NULL,
  `userAgent` VARCHAR(191) NULL,
  `suspiciousType` VARCHAR(191) NOT NULL,
  `details` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `GameAntiCheatLog_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `GameAntiCheatLog_gameType_createdAt_idx` (`gameType`, `createdAt`),
  INDEX `GameAntiCheatLog_suspiciousType_createdAt_idx` (`suspiciousType`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
