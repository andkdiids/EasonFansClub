-- Add the independent 3-4 player Undercover Star room and match domain.
-- This migration only creates new tables and indexes; it does not alter or
-- remove existing game data.

CREATE TABLE `UndercoverWordPair` (
  `id` VARCHAR(191) NOT NULL,
  `civilianWord` VARCHAR(191) NOT NULL,
  `undercoverWord` VARCHAR(191) NOT NULL,
  `normalizedCivilianWord` VARCHAR(191) NOT NULL,
  `normalizedUndercoverWord` VARCHAR(191) NOT NULL,
  `category` ENUM('SONG', 'ALBUM', 'EASON_RELATED', 'GENERAL') NOT NULL DEFAULT 'GENERAL',
  `difficulty` ENUM('EASY', 'NORMAL', 'HARD') NOT NULL DEFAULT 'NORMAL',
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `usageCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverWordPair_normalized_pair_key` (`normalizedCivilianWord`, `normalizedUndercoverWord`),
  INDEX `UndercoverWordPair_enabled_difficulty_category_createdAt_idx` (`enabled`, `difficulty`, `category`, `createdAt`),
  INDEX `UndercoverWordPair_enabled_usageCount_idx` (`enabled`, `usageCount`),
  INDEX `UndercoverWordPair_civilianWord_idx` (`civilianWord`),
  INDEX `UndercoverWordPair_undercoverWord_idx` (`undercoverWord`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UndercoverRoom` (
  `id` VARCHAR(191) NOT NULL,
  `roomCode` VARCHAR(191) NOT NULL,
  `passwordHash` VARCHAR(191) NULL,
  `isPublic` BOOLEAN NOT NULL DEFAULT true,
  `status` ENUM('WAITING', 'PLAYING', 'FINISHED', 'CANCELLED') NOT NULL DEFAULT 'WAITING',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  `hostId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverRoom_roomCode_key` (`roomCode`),
  INDEX `UndercoverRoom_status_isPublic_lastActivityAt_idx` (`status`, `isPublic`, `lastActivityAt`),
  INDEX `UndercoverRoom_hostId_status_idx` (`hostId`, `status`),
  INDEX `UndercoverRoom_lastActivityAt_idx` (`lastActivityAt`),
  CONSTRAINT `UndercoverRoom_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UndercoverRoomPlayer` (
  `id` VARCHAR(191) NOT NULL,
  `isReady` BOOLEAN NOT NULL DEFAULT false,
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `lastSeenAt` DATETIME(3) NULL,
  `leftAt` DATETIME(3) NULL,
  `roomId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverRoomPlayer_roomId_userId_key` (`roomId`, `userId`),
  INDEX `UndercoverRoomPlayer_userId_leftAt_idx` (`userId`, `leftAt`),
  INDEX `UndercoverRoomPlayer_roomId_leftAt_joinedAt_idx` (`roomId`, `leftAt`, `joinedAt`),
  CONSTRAINT `UndercoverRoomPlayer_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `UndercoverRoom` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UndercoverRoomPlayer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UndercoverMatch` (
  `id` VARCHAR(191) NOT NULL,
  `status` ENUM('PLAYING', 'FINISHED', 'CANCELLED') NOT NULL DEFAULT 'PLAYING',
  `phase` ENUM('ROLE_REVEAL', 'DESCRIBING', 'VOTING', 'TIE_VOTING', 'UNDERCOVER_GUESS', 'FINISHED') NOT NULL DEFAULT 'ROLE_REVEAL',
  `finishReason` ENUM('UNDERCOVER_SURVIVAL', 'UNDERCOVER_GUESS_CORRECT', 'UNDERCOVER_GUESS_WRONG', 'UNDERCOVER_GUESS_TIMEOUT') NULL,
  `winner` ENUM('CIVILIAN', 'UNDERCOVER') NULL,
  `round` INTEGER NOT NULL DEFAULT 1,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `civilianWord` VARCHAR(191) NOT NULL,
  `undercoverWord` VARCHAR(191) NOT NULL,
  `speakingOrder` JSON NOT NULL,
  `currentSpeakerId` VARCHAR(191) NULL,
  `currentSpeakerIndex` INTEGER NULL,
  `phaseDeadline` DATETIME(3) NULL,
  `tieCandidateIds` JSON NULL,
  `roundHistory` JSON NULL,
  `undercoverGuess` VARCHAR(191) NULL,
  `undercoverGuessCorrect` BOOLEAN NULL,
  `undercoverGuessAt` DATETIME(3) NULL,
  `finalResult` JSON NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `roomId` VARCHAR(191) NOT NULL,
  `wordPairId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverMatch_roomId_key` (`roomId`),
  INDEX `UndercoverMatch_status_phase_phaseDeadline_idx` (`status`, `phase`, `phaseDeadline`),
  INDEX `UndercoverMatch_roomId_status_idx` (`roomId`, `status`),
  INDEX `UndercoverMatch_status_finishedAt_idx` (`status`, `finishedAt`),
  INDEX `UndercoverMatch_updatedAt_idx` (`updatedAt`),
  CONSTRAINT `UndercoverMatch_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `UndercoverRoom` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UndercoverMatch_wordPairId_fkey` FOREIGN KEY (`wordPairId`) REFERENCES `UndercoverWordPair` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UndercoverMatchPlayer` (
  `id` VARCHAR(191) NOT NULL,
  `role` ENUM('CIVILIAN', 'UNDERCOVER') NOT NULL,
  `word` VARCHAR(191) NOT NULL,
  `isAlive` BOOLEAN NOT NULL DEFAULT true,
  `roleConfirmedAt` DATETIME(3) NULL,
  `eliminatedAt` DATETIME(3) NULL,
  `eliminatedRound` INTEGER NULL,
  `isOnline` BOOLEAN NOT NULL DEFAULT false,
  `lastSeenAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `matchId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverMatchPlayer_matchId_userId_key` (`matchId`, `userId`),
  INDEX `UndercoverMatchPlayer_matchId_isAlive_idx` (`matchId`, `isAlive`),
  INDEX `UndercoverMatchPlayer_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `UndercoverMatchPlayer_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `UndercoverMatch` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UndercoverMatchPlayer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UndercoverDescription` (
  `id` VARCHAR(191) NOT NULL,
  `round` INTEGER NOT NULL,
  `content` VARCHAR(120) NOT NULL,
  `isAuto` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `matchId` VARCHAR(191) NOT NULL,
  `matchPlayerId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverDescription_matchId_round_matchPlayerId_key` (`matchId`, `round`, `matchPlayerId`),
  INDEX `UndercoverDescription_matchId_round_createdAt_idx` (`matchId`, `round`, `createdAt`),
  CONSTRAINT `UndercoverDescription_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `UndercoverMatch` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UndercoverDescription_matchPlayerId_fkey` FOREIGN KEY (`matchPlayerId`) REFERENCES `UndercoverMatchPlayer` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UndercoverVote` (
  `id` VARCHAR(191) NOT NULL,
  `round` INTEGER NOT NULL,
  `stage` ENUM('MAIN', 'TIE') NOT NULL,
  `targetId` VARCHAR(191) NULL,
  `isAbstain` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `matchId` VARCHAR(191) NOT NULL,
  `voterId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverVote_matchId_round_stage_voterId_key` (`matchId`, `round`, `stage`, `voterId`),
  INDEX `UndercoverVote_matchId_round_stage_targetId_idx` (`matchId`, `round`, `stage`, `targetId`),
  CONSTRAINT `UndercoverVote_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `UndercoverMatch` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UndercoverVote_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `UndercoverMatchPlayer` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UndercoverVote_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `UndercoverMatchPlayer` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UndercoverStats` (
  `id` VARCHAR(191) NOT NULL,
  `totalGames` INTEGER NOT NULL DEFAULT 0,
  `totalWins` INTEGER NOT NULL DEFAULT 0,
  `totalLosses` INTEGER NOT NULL DEFAULT 0,
  `civilianGames` INTEGER NOT NULL DEFAULT 0,
  `civilianWins` INTEGER NOT NULL DEFAULT 0,
  `undercoverGames` INTEGER NOT NULL DEFAULT 0,
  `undercoverWins` INTEGER NOT NULL DEFAULT 0,
  `successfulUndercoverVotes` INTEGER NOT NULL DEFAULT 0,
  `undercoverSurvivalWins` INTEGER NOT NULL DEFAULT 0,
  `undercoverGuessWins` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UndercoverStats_userId_key` (`userId`),
  INDEX `UndercoverStats_totalWins_userId_idx` (`totalWins`, `userId`),
  INDEX `UndercoverStats_totalGames_userId_idx` (`totalGames`, `userId`),
  CONSTRAINT `UndercoverStats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
