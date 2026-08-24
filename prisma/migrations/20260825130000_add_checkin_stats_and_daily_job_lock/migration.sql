CREATE INDEX `CheckIn_checkinDateKey_mood_idx` ON `CheckIn`(`checkinDateKey`, `mood`);

CREATE TABLE `DailyJobExecution` (
  `id` VARCHAR(191) NOT NULL,
  `jobKey` VARCHAR(191) NOT NULL,
  `dateKey` VARCHAR(191) NOT NULL,
  `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `error` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `DailyJobExecution_jobKey_dateKey_key` (`jobKey`, `dateKey`),
  INDEX `DailyJobExecution_status_startedAt_idx` (`status`, `startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
