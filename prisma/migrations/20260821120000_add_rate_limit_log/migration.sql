CREATE TABLE `RateLimitLog` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `count` INT NOT NULL DEFAULT 1,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `RateLimitLog_expiresAt_idx` (`expiresAt`),
  INDEX `RateLimitLog_key_action_idx` (`key`, `action`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
