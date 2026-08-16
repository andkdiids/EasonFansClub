CREATE TABLE `WantListenFakeTitle` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `normalizedTitle` VARCHAR(191) NOT NULL,
  `difficulty` ENUM('EASY', 'NORMAL', 'HARD') NOT NULL DEFAULT 'NORMAL',
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `usageCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WantListenFakeTitle_normalizedTitle_key` (`normalizedTitle`),
  INDEX `WantListenFakeTitle_enabled_difficulty_createdAt_idx` (`enabled`, `difficulty`, `createdAt`),
  INDEX `WantListenFakeTitle_title_idx` (`title`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WantListenSession` (
  `id` VARCHAR(191) NOT NULL,
  `activeKey` VARCHAR(191) NULL,
  `userId` VARCHAR(191) NOT NULL,
  `mode` ENUM('WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE') NOT NULL,
  `status` ENUM('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'EXPIRED') NOT NULL DEFAULT 'IN_PROGRESS',
  `currentQuestion` INTEGER NOT NULL DEFAULT 1,
  `questionCount` INTEGER NOT NULL DEFAULT 20,
  `score` INTEGER NOT NULL DEFAULT 0,
  `correctCount` INTEGER NOT NULL DEFAULT 0,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `completionTimeMs` INTEGER NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WantListenSession_activeKey_key` (`activeKey`),
  INDEX `WantListenSession_userId_mode_status_idx` (`userId`, `mode`, `status`),
  INDEX `WantListenSession_status_expiresAt_idx` (`status`, `expiresAt`),
  INDEX `WantListenSession_mode_status_completedAt_idx` (`mode`, `status`, `completedAt`),
  INDEX `WantListenSession_userId_completedAt_idx` (`userId`, `completedAt`),
  INDEX `WantListenSession_createdAt_userId_idx` (`createdAt`, `userId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `WantListenSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WantListenSessionQuestion` (
  `id` VARCHAR(191) NOT NULL,
  `publicId` VARCHAR(191) NOT NULL,
  `position` INTEGER NOT NULL,
  `questionData` JSON NOT NULL,
  `correctOptionKey` VARCHAR(191) NOT NULL,
  `hintLevel` INTEGER NOT NULL DEFAULT 1,
  `selectedOptionKey` VARCHAR(191) NULL,
  `isCorrect` BOOLEAN NULL,
  `awardedScore` INTEGER NOT NULL DEFAULT 0,
  `answeredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sessionId` VARCHAR(191) NOT NULL,

  UNIQUE INDEX `WantListenSessionQuestion_publicId_key` (`publicId`),
  UNIQUE INDEX `WantListenSessionQuestion_sessionId_position_key` (`sessionId`, `position`),
  INDEX `WantListenSessionQuestion_sessionId_answeredAt_idx` (`sessionId`, `answeredAt`),
  INDEX `WantListenSessionQuestion_sessionId_position_idx` (`sessionId`, `position`),
  PRIMARY KEY (`id`),
  CONSTRAINT `WantListenSessionQuestion_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `WantListenSession` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WantListenStats` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `mode` ENUM('WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE') NOT NULL,
  `gamesPlayed` INTEGER NOT NULL DEFAULT 0,
  `totalQuestions` INTEGER NOT NULL DEFAULT 0,
  `totalCorrect` INTEGER NOT NULL DEFAULT 0,
  `bestScore` INTEGER NOT NULL DEFAULT 0,
  `currentStreak` INTEGER NOT NULL DEFAULT 0,
  `maxStreak` INTEGER NOT NULL DEFAULT 0,
  `perfectGames` INTEGER NOT NULL DEFAULT 0,
  `silentCurrentStreak` INTEGER NOT NULL DEFAULT 0,
  `silentMaxStreak` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WantListenStats_userId_mode_key` (`userId`, `mode`),
  INDEX `WantListenStats_mode_bestScore_idx` (`mode`, `bestScore`),
  INDEX `WantListenStats_userId_updatedAt_idx` (`userId`, `updatedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `WantListenStats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WantListenLeaderboardEntry` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(191) NOT NULL,
  `mode` ENUM('WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE') NOT NULL,
  `periodType` ENUM('DAY', 'WEEK', 'ALL') NOT NULL,
  `periodKey` VARCHAR(191) NOT NULL,
  `score` INTEGER NOT NULL,
  `correctCount` INTEGER NOT NULL,
  `completionTimeMs` INTEGER NOT NULL,
  `achievedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WantListenLeaderboardEntry_userId_mode_periodType_periodKey_key` (`userId`, `mode`, `periodType`, `periodKey`),
  INDEX `WantListenLeaderboardEntry_mode_periodType_periodKey_score_correctCount_completionTimeMs_idx` (`mode`, `periodType`, `periodKey`, `score`, `correctCount`, `completionTimeMs`),
  INDEX `WantListenLeaderboardEntry_userId_periodType_periodKey_idx` (`userId`, `periodType`, `periodKey`),
  INDEX `WantListenLeaderboardEntry_sessionId_idx` (`sessionId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `WantListenLeaderboardEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WantListenLeaderboardEntry_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `WantListenSession` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
