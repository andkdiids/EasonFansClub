-- Add risk state to a game session without changing game scoring rules.
ALTER TABLE `GuessSongSession`
  MODIFY COLUMN `status` ENUM('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'EXPIRED', 'CHEAT_DETECTED') NOT NULL DEFAULT 'IN_PROGRESS',
  ADD COLUMN `riskScore` INTEGER NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN `riskReasons` JSON NULL AFTER `riskScore`,
  ADD COLUMN `isValid` BOOLEAN NOT NULL DEFAULT true AFTER `riskReasons`,
  ADD COLUMN `clientSessionNonce` VARCHAR(128) NULL AFTER `isValid`,
  ADD COLUMN `clientSessionTokenIssuedAt` DATETIME(3) NULL AFTER `clientSessionNonce`,
  ADD COLUMN `invalidatedAt` DATETIME(3) NULL AFTER `clientSessionTokenIssuedAt`;

CREATE INDEX `GuessSongSession_riskScore_createdAt_idx` ON `GuessSongSession` (`riskScore`, `createdAt`);
CREATE INDEX `GuessSongSession_isValid_createdAt_idx` ON `GuessSongSession` (`isValid`, `createdAt`);

ALTER TABLE `GuessSongSessionQuestion`
  ADD COLUMN `questionAttemptTokenHash` VARCHAR(128) NULL AFTER `playCount`,
  ADD COLUMN `firstPlayedAt` DATETIME(3) NULL AFTER `questionAttemptTokenHash`,
  ADD COLUMN `answerLatencyMs` INTEGER NULL AFTER `firstPlayedAt`;

CREATE TABLE `GuessSongRiskLog` (
  `id` VARCHAR(191) NOT NULL,
  `mode` ENUM('EASY', 'ADVANCED', 'HARD', 'EXPERT', 'ENDLESS') NOT NULL,
  `score` INTEGER NOT NULL,
  `riskScore` INTEGER NOT NULL,
  `trigger` VARCHAR(64) NULL,
  `reasons` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `userId` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(191) NULL,

  PRIMARY KEY (`id`),
  INDEX `GuessSongRiskLog_createdAt_idx` (`createdAt`),
  INDEX `GuessSongRiskLog_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `GuessSongRiskLog_riskScore_createdAt_idx` (`riskScore`, `createdAt`),
  INDEX `GuessSongRiskLog_sessionId_idx` (`sessionId`),
  CONSTRAINT `GuessSongRiskLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongRiskLog_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `GuessSongSession` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
