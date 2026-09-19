-- Keep profile-background likes attached to the profile owner rather than to
-- a replaceable image URL. The daily action table is intentionally separate:
-- removing a current like must never return today's quota.

ALTER TABLE `Notification`
  ADD COLUMN `aggregateCount` INTEGER NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
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
    'USER_REWARD',
    'FRIEND_BIRTHDAY',
    'FEEDBACK',
    'REVIEW',
    'PROFILE_BACKGROUND_LIKE'
  ) NOT NULL;

CREATE TABLE `ProfileBackgroundLike` (
  `id` VARCHAR(191) NOT NULL,
  `likerId` VARCHAR(191) NOT NULL,
  `profileOwnerId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ProfileBgLike_liker_owner_key` (`likerId`, `profileOwnerId`),
  INDEX `ProfileBgLike_owner_created_idx` (`profileOwnerId`, `createdAt`),
  INDEX `ProfileBgLike_liker_created_idx` (`likerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProfileBackgroundLikeDailyAction` (
  `id` VARCHAR(191) NOT NULL,
  `likerId` VARCHAR(191) NOT NULL,
  `profileOwnerId` VARCHAR(191) NOT NULL,
  `businessDate` VARCHAR(10) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ProfileBgLikeDaily_liker_owner_date_key` (`likerId`, `profileOwnerId`, `businessDate`),
  INDEX `ProfileBgLikeDaily_liker_date_idx` (`likerId`, `businessDate`),
  INDEX `ProfileBgLikeDaily_owner_created_idx` (`profileOwnerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProfileBackgroundLike`
  ADD CONSTRAINT `ProfileBackgroundLike_likerId_fkey`
  FOREIGN KEY (`likerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProfileBackgroundLike_profileOwnerId_fkey`
  FOREIGN KEY (`profileOwnerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProfileBackgroundLikeDailyAction`
  ADD CONSTRAINT `ProfileBgLikeDailyAction_likerId_fkey`
  FOREIGN KEY (`likerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProfileBgLikeDailyAction_ownerId_fkey`
  FOREIGN KEY (`profileOwnerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
