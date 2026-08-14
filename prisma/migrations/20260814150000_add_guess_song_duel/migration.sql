-- Add the independent real-time 1v1 Guess Song Duel domain.
-- Waiting-room state is short-lived, but matches, answers, settlements and
-- player statistics are persisted for auditability and idempotent rewards.

ALTER TABLE `Achievement`
  MODIFY COLUMN `category` ENUM(
    'REGISTER',
    'CHECKIN_STREAK',
    'CHECKIN_TOTAL',
    'POST',
    'MUSIC',
    'DUEL',
    'FRIEND',
    'ACTIVE',
    'SPECIAL'
  ) NOT NULL;

ALTER TABLE `Notification`
  MODIFY COLUMN `type` ENUM(
    'REPLY',
    'LIKE',
    'SYSTEM',
    'MESSAGE',
    'ACTIVITY',
    'ADMIN',
    'FOLLOW',
    'BADGE',
    'FRIEND_REQUEST',
    'BIRTHDAY_GREETING',
    'GUESS_SONG_DUEL_INVITE'
  ) NOT NULL;

ALTER TABLE `PointLog`
  MODIFY COLUMN `action` ENUM(
    'POST_CREATE',
    'REPLY_CREATE',
    'DAILY_CHECK_IN',
    'POST_LIKE_RECEIVED',
    'ADMIN_ADJUST',
    'REGISTER',
    'LOGIN',
    'CONTINUOUS_CHECK_IN_BONUS',
    'FEATURED_POST',
    'ACTIVITY_REWARD',
    'BADGE_EXCHANGE',
    'ENTERTAINMENT_DAILY_DRAW',
    'POST_DAILY_FIRST',
    'POST_COMMENT_DAILY',
    'POST_COMMENT_RECEIVED',
    'COMMENT_POST',
    'COMMENT_REVOKE',
    'GUESS_SONG_DUEL_WIN'
  ) NOT NULL;

CREATE TABLE `GuessSongDuelRoom` (
  `id` VARCHAR(191) NOT NULL,
  `roomCode` VARCHAR(191) NOT NULL,
  `passwordHash` VARCHAR(191) NULL,
  `isPublic` BOOLEAN NOT NULL DEFAULT true,
  `status` ENUM('WAITING', 'READY', 'PLAYING', 'FINISHED', 'CLOSED') NOT NULL DEFAULT 'WAITING',
  `hostReady` BOOLEAN NOT NULL DEFAULT false,
  `challengerReady` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `closedAt` DATETIME(3) NULL,
  `hostId` VARCHAR(191) NOT NULL,
  `challengerId` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GuessSongDuelRoom_roomCode_key` (`roomCode`),
  INDEX `GuessSongDuelRoom_status_isPublic_createdAt_idx` (`status`, `isPublic`, `createdAt`),
  INDEX `GuessSongDuelRoom_hostId_status_idx` (`hostId`, `status`),
  INDEX `GuessSongDuelRoom_challengerId_status_idx` (`challengerId`, `status`),
  CONSTRAINT `GuessSongDuelRoom_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongDuelRoom_challengerId_fkey` FOREIGN KEY (`challengerId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GuessSongDuelMatch` (
  `id` VARCHAR(191) NOT NULL,
  `status` ENUM('PLAYING', 'FINISHED', 'INVALID', 'CLOSED') NOT NULL DEFAULT 'PLAYING',
  `finishReason` ENUM('SCORE_THRESHOLD', 'ALL_QUESTIONS', 'DISCONNECT', 'FORFEIT', 'DISCONNECT_INVALID', 'FORFEIT_INVALID') NULL,
  `winnerId` VARCHAR(191) NULL,
  `isDraw` BOOLEAN NOT NULL DEFAULT false,
  `isSuspicious` BOOLEAN NOT NULL DEFAULT false,
  `currentQuestionIndex` INTEGER NOT NULL DEFAULT 1,
  `totalQuestions` INTEGER NOT NULL DEFAULT 30,
  `completedQuestionCount` INTEGER NOT NULL DEFAULT 0,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `rewardAmount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `roomId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GuessSongDuelMatch_roomId_key` (`roomId`),
  INDEX `GuessSongDuelMatch_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `GuessSongDuelMatch_winnerId_finishedAt_idx` (`winnerId`, `finishedAt`),
  INDEX `GuessSongDuelMatch_startedAt_idx` (`startedAt`),
  CONSTRAINT `GuessSongDuelMatch_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `GuessSongDuelRoom` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongDuelMatch_winnerId_fkey` FOREIGN KEY (`winnerId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GuessSongDuelPlayer` (
  `id` VARCHAR(191) NOT NULL,
  `slot` INTEGER NOT NULL,
  `correctCount` INTEGER NOT NULL DEFAULT 0,
  `totalEffectiveAnswerMs` INTEGER NOT NULL DEFAULT 0,
  `isOnline` BOOLEAN NOT NULL DEFAULT false,
  `disconnectedAt` DATETIME(3) NULL,
  `reconnectDeadlineAt` DATETIME(3) NULL,
  `suspicious` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `matchId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GuessSongDuelPlayer_matchId_userId_key` (`matchId`, `userId`),
  UNIQUE INDEX `GuessSongDuelPlayer_matchId_slot_key` (`matchId`, `slot`),
  INDEX `GuessSongDuelPlayer_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `GuessSongDuelPlayer_matchId_isOnline_idx` (`matchId`, `isOnline`),
  CONSTRAINT `GuessSongDuelPlayer_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `GuessSongDuelMatch` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongDuelPlayer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GuessSongDuelQuestion` (
  `id` VARCHAR(191) NOT NULL,
  `publicToken` VARCHAR(191) NOT NULL,
  `questionIndex` INTEGER NOT NULL,
  `optionsSnapshot` JSON NOT NULL,
  `correctOptionKey` VARCHAR(191) NOT NULL,
  `songTitle` VARCHAR(191) NOT NULL,
  `albumTitle` VARCHAR(191) NULL,
  `audioStoragePath` VARCHAR(191) NOT NULL,
  `audioDurationSeconds` INTEGER NOT NULL,
  `serverStartedAt` DATETIME(3) NULL,
  `audioStartAt` DATETIME(3) NULL,
  `answerDeadlineAt` DATETIME(3) NULL,
  `revealedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `matchId` VARCHAR(191) NOT NULL,
  `sourceQuestionId` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GuessSongDuelQuestion_publicToken_key` (`publicToken`),
  UNIQUE INDEX `GuessSongDuelQuestion_matchId_questionIndex_key` (`matchId`, `questionIndex`),
  INDEX `GuessSongDuelQuestion_matchId_revealedAt_idx` (`matchId`, `revealedAt`),
  INDEX `GuessSongDuelQuestion_sourceQuestionId_idx` (`sourceQuestionId`),
  CONSTRAINT `GuessSongDuelQuestion_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `GuessSongDuelMatch` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongDuelQuestion_sourceQuestionId_fkey` FOREIGN KEY (`sourceQuestionId`) REFERENCES `GuessSongQuestion` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GuessSongDuelAnswer` (
  `id` VARCHAR(191) NOT NULL,
  `selectedOptionKey` VARCHAR(191) NULL,
  `isCorrect` BOOLEAN NOT NULL DEFAULT false,
  `clientElapsedMs` INTEGER NULL,
  `receivedAt` DATETIME(3) NOT NULL,
  `latencyEstimateMs` INTEGER NOT NULL DEFAULT 0,
  `effectiveElapsedMs` INTEGER NULL,
  `suspicious` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `matchId` VARCHAR(191) NOT NULL,
  `questionId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GuessSongDuelAnswer_matchId_questionId_userId_key` (`matchId`, `questionId`, `userId`),
  INDEX `GuessSongDuelAnswer_questionId_receivedAt_idx` (`questionId`, `receivedAt`),
  INDEX `GuessSongDuelAnswer_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `GuessSongDuelAnswer_suspicious_createdAt_idx` (`suspicious`, `createdAt`),
  CONSTRAINT `GuessSongDuelAnswer_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `GuessSongDuelMatch` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongDuelAnswer_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `GuessSongDuelQuestion` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongDuelAnswer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GuessSongDuelStats` (
  `id` VARCHAR(191) NOT NULL,
  `wins` INTEGER NOT NULL DEFAULT 0,
  `participations` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GuessSongDuelStats_userId_key` (`userId`),
  INDEX `GuessSongDuelStats_wins_userId_idx` (`wins`, `userId`),
  INDEX `GuessSongDuelStats_participations_userId_idx` (`participations`, `userId`),
  CONSTRAINT `GuessSongDuelStats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GuessSongDuelInvite` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `acceptedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `roomId` VARCHAR(191) NOT NULL,
  `inviterId` VARCHAR(191) NOT NULL,
  `inviteeId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GuessSongDuelInvite_tokenHash_key` (`tokenHash`),
  INDEX `GuessSongDuelInvite_roomId_inviteeId_expiresAt_idx` (`roomId`, `inviteeId`, `expiresAt`),
  INDEX `GuessSongDuelInvite_inviteeId_acceptedAt_expiresAt_idx` (`inviteeId`, `acceptedAt`, `expiresAt`),
  CONSTRAINT `GuessSongDuelInvite_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `GuessSongDuelRoom` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongDuelInvite_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GuessSongDuelInvite_inviteeId_fkey` FOREIGN KEY (`inviteeId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
