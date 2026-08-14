-- User contribution rewards are separate from ordinary daily reward limits.
-- The existing ExperienceLog and PointLog tables remain the source of truth
-- for the two balances; UserReward stores the auditable business record.

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
    'GUESS_SONG_DUEL_INVITE',
    'USER_REWARD'
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
    'GUESS_SONG_DUEL_WIN',
    'USER_REWARD'
  ) NOT NULL;

CREATE TABLE `UserReward` (
  `id` VARCHAR(191) NOT NULL,
  `transactionId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `operatorId` VARCHAR(191) NOT NULL,
  `usernameSnapshot` VARCHAR(191) NOT NULL,
  `experienceAmount` INTEGER NOT NULL DEFAULT 0,
  `registrationFeeAmount` INTEGER NOT NULL DEFAULT 0,
  `reason` VARCHAR(500) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `UserReward_transactionId_key` (`transactionId`),
  INDEX `UserReward_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `UserReward_operatorId_createdAt_idx` (`operatorId`, `createdAt`),
  INDEX `UserReward_createdAt_idx` (`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `UserReward_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UserReward_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
