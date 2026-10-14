ALTER TABLE `Activity`
  MODIFY `type` ENUM('OFFLINE', 'ONLINE', 'CONCERT', 'COMMUNITY', 'BENEFIT', 'OTHER', 'TOPIC_ACTIVITY') NOT NULL DEFAULT 'OTHER',
  ADD COLUMN `pinToPlaza` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `activityPostId` VARCHAR(191) NULL,
  ADD COLUMN `participationRule` TEXT NULL,
  ADD COLUMN `rewardGrantMode` ENUM('IMMEDIATE', 'SCHEDULED') NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN `rewardGrantAt` DATETIME(3) NULL,
  ADD COLUMN `rewardPoints` INTEGER NULL,
  ADD COLUMN `rewardBadgeIds` JSON NULL;

ALTER TABLE `Activity`
  ADD UNIQUE INDEX `Activity_activityPostId_key` (`activityPostId`),
  ADD INDEX `Activity_pinToPlaza_endsAt_status_idx` (`pinToPlaza`, `endsAt`, `status`),
  ADD CONSTRAINT `Activity_activityPostId_fkey` FOREIGN KEY (`activityPostId`) REFERENCES `Post`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Post`
  ADD COLUMN `activityPinned` BOOLEAN NOT NULL DEFAULT false,
  ADD INDEX `Post_activityPinned_createdAt_idx` (`activityPinned`, `createdAt`);

ALTER TABLE `PointLog`
  MODIFY `action` ENUM('POST_CREATE', 'REPLY_CREATE', 'DAILY_CHECK_IN', 'POST_LIKE_RECEIVED', 'ADMIN_ADJUST', 'REGISTER', 'LOGIN', 'CONTINUOUS_CHECK_IN_BONUS', 'FEATURED_POST', 'ACTIVITY_REWARD', 'BADGE_EXCHANGE', 'ENTERTAINMENT_DAILY_DRAW', 'POST_DAILY_FIRST', 'POST_COMMENT_DAILY', 'POST_COMMENT_RECEIVED', 'COMMENT_POST', 'COMMENT_REVOKE', 'GUESS_SONG_DUEL_WIN', 'USER_REWARD', 'CHECK_IN_MAKEUP', 'MATERIAL_REDEMPTION', 'MATERIAL_REDEMPTION_REFUND', 'ACTIVITY_REGISTRATION_FEE', 'ACTIVITY_REGISTRATION_REFUND', 'ACTIVITY_LOTTERY_PRIZE', 'PHARMACY_DRAW_COST', 'PHARMACY_PRIZE_REWARD', 'PHARMACY_DUPLICATE_RECYCLE', 'GROWTH_REWARD', 'GROWTH_REWARD_REVERSAL', 'GLOBAL_POINTS_GRANT', 'TOPIC_ACTIVITY_REWARD') NOT NULL;

ALTER TABLE `BadgeRule`
  MODIFY `ruleType` ENUM('POST_COUNT', 'FEATURED_POST_COUNT', 'CHECKIN_TOTAL_DAYS', 'CHECKIN_STREAK', 'ACCOUNT_AGE_DAYS', 'FRIEND_COUNT', 'FOLLOWER_COUNT', 'GUESS_SONG_MAX_STREAK', 'DUEL_WIN_COUNT', 'WANT_LISTEN_MAX_STREAK', 'CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED', 'RATING_COUNT', 'BADGE_SERIES_COMPLETE', 'ACTIVITY_PARTICIPATION', 'TOPIC_ACTIVITY_PARTICIPATION_COUNT', 'BIRTHDAY_ZODIAC', 'BIRTHDAY_TODAY', 'CHECKIN_ON_DATE', 'BADGE_OWNERSHIP', 'CLINIC_CONSULTATION_STREAK') NOT NULL;

CREATE TABLE `TopicActivityParticipation` (
  `id` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `firstApprovedSubmissionId` VARCHAR(191) NULL,
  `firstApprovedAt` DATETIME(3) NULL,
  `approvedSubmissionCount` INTEGER NOT NULL DEFAULT 0,
  `rewardStatus` ENUM('NOT_ELIGIBLE', 'PENDING', 'PROCESSING', 'GRANTED', 'PARTIAL', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'NOT_ELIGIBLE',
  `rewardEligibleAt` DATETIME(3) NULL,
  `rewardGrantedAt` DATETIME(3) NULL,
  `reviewReversedAfterReward` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TopicActivityParticipation_activityId_userId_key` (`activityId`, `userId`),
  INDEX `TopicActPart_user_approved_first_idx` (`userId`, `approvedSubmissionCount`, `firstApprovedAt`),
  INDEX `TopicActivityParticipation_activityId_rewardStatus_idx` (`activityId`, `rewardStatus`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TopicActivityParticipation_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityParticipation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TopicActivitySubmission` (
  `id` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `commentId` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedAt` DATETIME(3) NULL,
  `reviewedById` VARCHAR(191) NULL,
  `rejectReason` TEXT NULL,
  `commentDeletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TopicActivitySubmission_commentId_key` (`commentId`),
  INDEX `TopicActivitySubmission_activityId_status_submittedAt_idx` (`activityId`, `status`, `submittedAt`),
  INDEX `TopicActivitySubmission_userId_activityId_status_idx` (`userId`, `activityId`, `status`),
  INDEX `TopicActivitySubmission_reviewedById_reviewedAt_idx` (`reviewedById`, `reviewedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TopicActivitySubmission_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivitySubmission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivitySubmission_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `Reply`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `TopicActivitySubmission_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TopicActivityReviewLog` (
  `id` VARCHAR(191) NOT NULL,
  `submissionId` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `commentId` VARCHAR(191) NULL,
  `fromStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL,
  `toStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL,
  `reviewedById` VARCHAR(191) NULL,
  `reason` TEXT NULL,
  `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `TopicActivityReviewLog_submissionId_reviewedAt_idx` (`submissionId`, `reviewedAt`),
  INDEX `TopicActivityReviewLog_activityId_reviewedAt_idx` (`activityId`, `reviewedAt`),
  INDEX `TopicActivityReviewLog_userId_reviewedAt_idx` (`userId`, `reviewedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TopicActivityReviewLog_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `TopicActivitySubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityReviewLog_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityReviewLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityReviewLog_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TopicActivityRewardGrant` (
  `id` VARCHAR(191) NOT NULL,
  `participationId` VARCHAR(191) NOT NULL,
  `activityId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `kind` ENUM('POINTS', 'BADGE') NOT NULL,
  `badgeId` VARCHAR(191) NULL,
  `points` INTEGER NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'GRANTED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `grantKey` VARCHAR(191) NOT NULL,
  `errorMessage` VARCHAR(500) NULL,
  `grantedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TopicActivityRewardGrant_grantKey_key` (`grantKey`),
  INDEX `TopicActivityRewardGrant_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `TopicActivityRewardGrant_activityId_status_idx` (`activityId`, `status`),
  INDEX `TopicActivityRewardGrant_participationId_status_idx` (`participationId`, `status`),
  INDEX `TopicActivityRewardGrant_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `TopicActivityRewardGrant_badgeId_idx` (`badgeId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TopicActivityRewardGrant_participationId_fkey` FOREIGN KEY (`participationId`) REFERENCES `TopicActivityParticipation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityRewardGrant_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityRewardGrant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TopicActivityRewardGrant_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
