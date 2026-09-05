-- Add BADGE_OWNERSHIP and normalized dependency/source indexes.
-- This migration is intentionally not executed in this change.

ALTER TABLE `BadgeRule`
  MODIFY COLUMN `ruleType` ENUM(
    'POST_COUNT',
    'FEATURED_POST_COUNT',
    'CHECKIN_TOTAL_DAYS',
    'CHECKIN_STREAK',
    'ACCOUNT_AGE_DAYS',
    'FRIEND_COUNT',
    'FOLLOWER_COUNT',
    'GUESS_SONG_MAX_STREAK',
    'DUEL_WIN_COUNT',
    'WANT_LISTEN_MAX_STREAK',
    'CONCERT_ATTENDANCE_COUNT',
    'CONCERT_SHOW_ATTENDED',
    'CONCERT_TOUR_ATTENDED',
    'RATING_COUNT',
    'BADGE_SERIES_COMPLETE',
    'ACTIVITY_PARTICIPATION',
    'BIRTHDAY_ZODIAC',
    'BIRTHDAY_TODAY',
    'BADGE_OWNERSHIP'
  ) NOT NULL;

CREATE TABLE `BadgeRuleDependency` (
  `id` VARCHAR(191) NOT NULL,
  `sourceBadgeId` VARCHAR(191) NOT NULL,
  `targetBadgeId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `BadgeRuleDependency_sourceBadgeId_targetBadgeId_key`(`sourceBadgeId`, `targetBadgeId`),
  INDEX `BadgeRuleDependency_sourceBadgeId_idx`(`sourceBadgeId`),
  INDEX `BadgeRuleDependency_targetBadgeId_idx`(`targetBadgeId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `BadgeRuleDependency_sourceBadgeId_fkey` FOREIGN KEY (`sourceBadgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `BadgeRuleDependency_targetBadgeId_fkey` FOREIGN KEY (`targetBadgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UserBadgeSource` (
  `id` VARCHAR(191) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(32) NOT NULL,
  `sourceId` VARCHAR(191) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NULL,
  `expiredAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `grantReason` VARCHAR(500) NULL,
  `grantedBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `badgeId` VARCHAR(191) NOT NULL,
  `userBadgeId` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `UserBadgeSource_sourceKey_key`(`sourceKey`),
  INDEX `UserBadgeSource_userId_badgeId_isActive_idx`(`userId`, `badgeId`, `isActive`),
  INDEX `UserBadgeSource_badgeId_sourceType_sourceId_isActive_idx`(`badgeId`, `sourceType`, `sourceId`, `isActive`),
  INDEX `UserBadgeSource_userBadgeId_isActive_idx`(`userBadgeId`, `isActive`),
  PRIMARY KEY (`id`),
  CONSTRAINT `UserBadgeSource_userBadgeId_fkey` FOREIGN KEY (`userBadgeId`) REFERENCES `UserBadge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UserBadgeSource_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UserBadgeSource_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UserBadgeSource_grantedBy_fkey` FOREIGN KEY (`grantedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Only current UserBadge ownership needs a source row. Historical/expired
-- UserBadge rows remain the immutable grant history and are intentionally not
-- copied into this current-source table. Preserve the runtime source key for
-- rows that already carry a source identity, so a later ownership-rule revoke
-- can find the migrated AUTO_RULE source instead of leaving a duplicate one.
INSERT INTO `UserBadgeSource` (
  `id`, `sourceKey`, `sourceType`, `sourceId`, `isActive`, `grantedAt`,
  `expiresAt`, `expiredAt`, `revokedAt`, `grantReason`, `grantedBy`,
  `createdAt`, `updatedAt`, `userId`, `badgeId`, `userBadgeId`
)
SELECT
  UUID(),
  SHA2(CONCAT(
    'badge-source:', `userId`, ':', `badgeId`, ':',
    COALESCE(NULLIF(`sourceType`, ''), 'LEGACY'), ':',
    COALESCE(NULLIF(`sourceId`, ''), NULLIF(`grantKey`, ''), 'default')
  ), 256),
  COALESCE(NULLIF(`sourceType`, ''), 'LEGACY'),
  `sourceId`,
  TRUE,
  COALESCE(`awardedAt`, `obtainedAt`, `grantedAt`, `createdAt`),
  `expiresAt`,
  `expiredAt`,
  `revokedAt`,
  `grantReason`,
  `grantedBy`,
  `createdAt`,
  CURRENT_TIMESTAMP(3),
  `userId`,
  `badgeId`,
  `id`
FROM `UserBadge`
WHERE `status` = 'ACTIVE'
  AND (`expiresAt` IS NULL OR `expiresAt` > CURRENT_TIMESTAMP(3));
