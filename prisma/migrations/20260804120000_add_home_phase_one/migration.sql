-- 私家 E 院 V2.0 第一阶段：首页每日推荐、今日内容和帖子审核。

ALTER TABLE `Post`
  ADD COLUMN `moderationStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN `reviewedAt` DATETIME(3) NULL,
  ADD COLUMN `reviewedById` VARCHAR(191) NULL,
  ADD COLUMN `rejectionReason` TEXT NULL;

CREATE INDEX `Post_moderationStatus_createdAt_idx`
  ON `Post`(`moderationStatus`, `createdAt`);

ALTER TABLE `AdminAction`
  MODIFY COLUMN `action` ENUM(
    'APPROVE_POST', 'DELETE_POST', 'REJECT_POST', 'RESTORE_POST',
    'PIN_POST', 'UNPIN_POST', 'FEATURE_POST', 'UNFEATURE_POST',
    'DELETE_REPLY', 'RESTORE_REPLY', 'ADJUST_POINTS', 'UPDATE_BOARD',
    'UPDATE_USER_ROLE', 'DELETE_USER', 'RESTORE_USER', 'BAN_USER',
    'UNBAN_USER', 'UPDATE_USER_POINTS', 'RECOMMEND_POST', 'UNRECOMMEND_POST',
    'LOCK_POST', 'UNLOCK_POST', 'CREATE_BOARD', 'DELETE_BOARD',
    'CREATE_BADGE', 'GRANT_BADGE', 'CREATE_ACTIVITY', 'UPDATE_SETTING'
  ) NOT NULL;

CREATE TABLE `UserDailyMusicRecommendation` (
  `id` VARCHAR(191) NOT NULL,
  `recommendDate` VARCHAR(191) NOT NULL,
  `anonymousId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `userId` VARCHAR(191) NULL,
  `songId` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `UserDailyMusicRecommendation_userId_recommendDate_key`(`userId`, `recommendDate`),
  UNIQUE INDEX `UserDailyMusicRecommendation_anonymousId_recommendDate_key`(`anonymousId`, `recommendDate`),
  INDEX `UserDailyMusicRecommendation_recommendDate_idx`(`recommendDate`),
  INDEX `UserDailyMusicRecommendation_songId_recommendDate_idx`(`songId`, `recommendDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TodayEvent` (
  `id` VARCHAR(191) NOT NULL,
  `date` DATE NOT NULL,
  `month` INTEGER NOT NULL,
  `day` INTEGER NOT NULL,
  `type` ENUM('BIRTHDAY', 'DEBUT', 'ROOKIE_CONTEST', 'ALBUM_RELEASE', 'CONCERT', 'AWARD', 'OTHER') NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `imageUrl` VARCHAR(191) NULL,
  `source` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `rejectionReason` TEXT NULL,
  `reviewedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `submittedById` VARCHAR(191) NULL,
  `reviewedById` VARCHAR(191) NULL,
  INDEX `TodayEvent_month_day_status_idx`(`month`, `day`, `status`),
  INDEX `TodayEvent_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `TodayEvent_submittedById_createdAt_idx`(`submittedById`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserDailyMusicRecommendation`
  ADD CONSTRAINT `UserDailyMusicRecommendation_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `UserDailyMusicRecommendation_songId_fkey`
    FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `TodayEvent`
  ADD CONSTRAINT `TodayEvent_submittedById_fkey`
    FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `TodayEvent_reviewedById_fkey`
    FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
