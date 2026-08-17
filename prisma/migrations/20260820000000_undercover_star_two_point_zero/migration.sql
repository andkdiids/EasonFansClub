-- 卧底巨星 2.0：房间承载多局 Match、等候聊天室、幂等结算、成长等级
-- 向后兼容：仅移除 roomId 唯一约束，不破坏、不丢弃任何历史数据。

-- 1) Room 1 <-> N Match：移除 UndercoverMatch.roomId 唯一约束（保留 roomId+status 普通索引）
ALTER TABLE UndercoverMatch DROP INDEX UndercoverMatch_roomId_key;

-- 2) UndercoverRoom：房间锁定难度 + 指向当前/最近一局的指针
ALTER TABLE UndercoverRoom ADD COLUMN difficulty ENUM('EASY','NORMAL','HARD') NOT NULL DEFAULT 'NORMAL';
ALTER TABLE UndercoverRoom ADD COLUMN currentMatchId VARCHAR(191) NULL;
ALTER TABLE UndercoverRoom ADD INDEX UndercoverRoom_currentMatchId_idx (currentMatchId);

-- 3) UndercoverMatch：同一房间可有多局，记录局号
ALTER TABLE UndercoverMatch ADD COLUMN matchNumber INTEGER NOT NULL DEFAULT 1;

-- 4) 等候聊天室消息
CREATE TABLE UndercoverRoomMessage (
  `id` VARCHAR(191) NOT NULL,
  `content` VARCHAR(200) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `roomId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `UndercoverRoomMessage_roomId_createdAt_idx` (`roomId`, `createdAt`),
  CONSTRAINT `UndercoverRoomMessage_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `UndercoverRoom` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UndercoverRoomMessage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5) 每局每人的结算结果（matchId+userId 唯一 → 幂等）
CREATE TABLE UndercoverMatchResult (
  `id` VARCHAR(191) NOT NULL,
  `role` ENUM('CIVILIAN','UNDERCOVER') NOT NULL,
  `isWin` BOOLEAN NOT NULL DEFAULT false,
  `xpAwarded` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `matchId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverMatchResult_matchId_userId_key` (`matchId`, `userId`),
  INDEX `UndercoverMatchResult_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `UndercoverMatchResult_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `UndercoverMatch` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UndercoverMatchResult_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 6) 成长系统：经验与等级
ALTER TABLE UndercoverStats ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE UndercoverStats ADD COLUMN level INTEGER NOT NULL DEFAULT 1;

-- 7) 每局锁定本局实际难度（Room.difficulty 之后可被房主改，历史 Match 需独立快照）
ALTER TABLE UndercoverMatch ADD COLUMN difficulty ENUM('EASY','NORMAL','HARD') NOT NULL DEFAULT 'NORMAL';
