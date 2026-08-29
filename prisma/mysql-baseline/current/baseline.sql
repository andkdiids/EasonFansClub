-- CreateTable
CREATE TABLE `AccountSecurityLog` (
    `id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,

    INDEX `AccountSecurityLog_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `AccountSecurityLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Achievement` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `icon` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,
    `category` ENUM('REGISTER', 'CHECKIN_STREAK', 'CHECKIN_TOTAL', 'POST', 'MUSIC', 'DUEL', 'FRIEND', 'ACTIVE', 'SPECIAL') NOT NULL,
    `rarity` ENUM('NORMAL', 'RARE', 'EPIC', 'LEGENDARY', 'LIMITED') NOT NULL DEFAULT 'NORMAL',
    `conditionKey` VARCHAR(191) NULL,
    `conditionValue` INTEGER NULL,
    `isAutoGrant` BOOLEAN NOT NULL DEFAULT true,
    `isVisible` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Achievement_slug_key`(`slug`),
    INDEX `Achievement_category_sortOrder_idx`(`category`, `sortOrder`),
    INDEX `Achievement_isVisible_idx`(`isVisible`),
    INDEX `Achievement_rarity_idx`(`rarity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Activity` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(300) NULL,
    `description` TEXT NOT NULL,
    `type` ENUM('OFFLINE', 'ONLINE', 'CONCERT', 'COMMUNITY', 'BENEFIT', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `status` ENUM('DRAFT', 'PUBLISHED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `coverUrl` VARCHAR(191) NULL,
    `bannerUrl` VARCHAR(191) NULL,
    `locationName` VARCHAR(300) NULL,
    `locationAddress` VARCHAR(500) NULL,
    `onlineUrl` VARCHAR(500) NULL,
    `pointsReward` INTEGER NULL,
    `registrationFee` INTEGER NOT NULL DEFAULT 0,
    `feeDescription` TEXT NULL,
    `signupLimit` INTEGER NULL,
    `signupCount` INTEGER NOT NULL DEFAULT 0,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `registrationStartAt` DATETIME(3) NULL,
    `registrationEndAt` DATETIME(3) NULL,
    `verificationMode` ENUM('NONE', 'MANUAL', 'QR') NOT NULL DEFAULT 'NONE',
    `organizer` VARCHAR(160) NULL,
    `contactInfo` VARCHAR(500) NULL,
    `isFeatured` BOOLEAN NOT NULL DEFAULT false,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Activity_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Activity_status_startsAt_idx`(`status`, `startsAt`),
    INDEX `Activity_type_idx`(`type`),
    INDEX `Activity_isPinned_sortOrder_startsAt_idx`(`isPinned`, `sortOrder`, `startsAt`),
    INDEX `Activity_isFeatured_idx`(`isFeatured`),
    INDEX `Activity_publishedAt_idx`(`publishedAt`),
    INDEX `Activity_createdById_idx`(`createdById`),
    INDEX `Activity_updatedById_idx`(`updatedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activityId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ActivityFavorite_activityId_userId_key`(`activityId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityRegistration` (
    `id` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `paidRegistrationFee` INTEGER NOT NULL DEFAULT 0,
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cancelledAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifiedById` VARCHAR(191) NULL,
    `verificationMethod` ENUM('MANUAL', 'QR') NULL,
    `verificationToken` VARCHAR(128) NULL,
    `checkedInAt` DATETIME(3) NULL,
    `checkInSource` ENUM('MANUAL', 'QR', 'AUTO_AFTER_ACTIVITY_END') NULL,
    `linkedMaterialRedemptionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ActivityRegistration_verificationToken_key`(`verificationToken`),
    UNIQUE INDEX `ActivityRegistration_linkedMaterialRedemptionId_key`(`linkedMaterialRedemptionId`),
    INDEX `ActivityRegistration_activityId_status_idx`(`activityId`, `status`),
    INDEX `ActivityRegistration_userId_registeredAt_idx`(`userId`, `registeredAt`),
    INDEX `ActivityRegistration_verifiedById_verifiedAt_idx`(`verifiedById`, `verifiedAt`),
    INDEX `ActivityRegistration_checkInSource_verifiedAt_idx`(`checkInSource`, `verifiedAt`),
    UNIQUE INDEX `ActivityRegistration_activityId_userId_key`(`activityId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityRegistrationQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `type` ENUM('TEXT', 'TEXTAREA', 'SINGLE_SELECT', 'MULTI_SELECT', 'NUMBER', 'PHONE', 'SELECT') NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `placeholder` VARCHAR(300) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ActivityRegistrationQuestion_activityId_sortOrder_id_idx`(`activityId`, `sortOrder`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityRegistrationQuestionOption` (
    `id` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(300) NOT NULL,
    `value` VARCHAR(300) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ActivityRegistrationQuestionOption_questionId_sortOrder_id_idx`(`questionId`, `sortOrder`, `id`),
    UNIQUE INDEX `ActivityRegistrationQuestionOption_questionId_value_key`(`questionId`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityRegistrationAnswer` (
    `id` VARCHAR(191) NOT NULL,
    `registrationId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `questionTitle` VARCHAR(300) NOT NULL,
    `value` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ActivityRegistrationAnswer_questionId_idx`(`questionId`),
    UNIQUE INDEX `ActivityRegistrationAnswer_registrationId_questionId_key`(`registrationId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityReward` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `type` ENUM('BADGE') NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ActivityReward_badgeId_idx`(`badgeId`),
    UNIQUE INDEX `ActivityReward_activityId_type_key`(`activityId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAction` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('APPROVE_POST', 'EDIT_POST', 'DELETE_POST', 'REJECT_POST', 'RESTORE_POST', 'PIN_POST', 'UNPIN_POST', 'FEATURE_POST', 'UNFEATURE_POST', 'DELETE_REPLY', 'RESTORE_REPLY', 'ADJUST_POINTS', 'UPDATE_BOARD', 'UPDATE_USER_ROLE', 'DELETE_USER', 'RESTORE_USER', 'BAN_USER', 'UNBAN_USER', 'UPDATE_USER_POINTS', 'RECOMMEND_POST', 'UNRECOMMEND_POST', 'LOCK_POST', 'UNLOCK_POST', 'CREATE_BOARD', 'DELETE_BOARD', 'CREATE_BADGE', 'GRANT_BADGE', 'CREATE_ACTIVITY', 'UPDATE_SETTING') NOT NULL,
    `reason` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `adminId` VARCHAR(191) NULL,
    `operatorName` VARCHAR(191) NULL,
    `operatorUsername` VARCHAR(191) NULL,
    `operatorUid` INTEGER NULL,
    `operationType` VARCHAR(191) NULL,
    `targetType` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `targetTitle` VARCHAR(191) NULL,
    `targetUserId` VARCHAR(191) NULL,
    `targetUserName` VARCHAR(191) NULL,
    `targetUserUid` INTEGER NULL,
    `result` VARCHAR(191) NULL DEFAULT 'SUCCESS',
    `postId` VARCHAR(191) NULL,
    `replyId` VARCHAR(191) NULL,
    `boardId` VARCHAR(191) NULL,

    INDEX `AdminAction_action_idx`(`action`),
    INDEX `AdminAction_operationType_createdAt_idx`(`operationType`, `createdAt`),
    INDEX `AdminAction_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `AdminAction_operatorUid_createdAt_idx`(`operatorUid`, `createdAt`),
    INDEX `AdminAction_targetType_createdAt_idx`(`targetType`, `createdAt`),
    INDEX `AdminAction_targetId_createdAt_idx`(`targetId`, `createdAt`),
    INDEX `AdminAction_boardId_idx`(`boardId`),
    INDEX `AdminAction_postId_idx`(`postId`),
    INDEX `AdminAction_replyId_idx`(`replyId`),
    INDEX `AdminAction_targetUserId_idx`(`targetUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminActionLog` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetUserId` VARCHAR(191) NOT NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminActionLog_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `AdminActionLog_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `AdminActionLog_targetUserId_createdAt_idx`(`targetUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminPermission` (
    `id` VARCHAR(191) NOT NULL,
    `permissionKey` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `AdminPermission_permissionKey_enabled_idx`(`permissionKey`, `enabled`),
    INDEX `AdminPermission_userId_enabled_idx`(`userId`, `enabled`),
    UNIQUE INDEX `AdminPermission_userId_permissionKey_key`(`userId`, `permissionKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaterialRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `coverImageUrl` TEXT NULL,
    `instructions` TEXT NULL,
    `cost` INTEGER NOT NULL DEFAULT 0,
    `stockTotal` INTEGER NOT NULL,
    `stockRemaining` INTEGER NOT NULL,
    `perUserLimit` INTEGER NOT NULL DEFAULT 1,
    `exchangeStartAt` DATETIME(3) NOT NULL,
    `exchangeEndAt` DATETIME(3) NOT NULL,
    `redeemEndAt` DATETIME(3) NOT NULL,
    `redemptionRule` ENUM('DEFAULT', 'ACTIVITY_REGISTRATION_REQUIRED') NOT NULL DEFAULT 'DEFAULT',
    `linkedActivityId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'ENDED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `createdByAdminId` VARCHAR(191) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MaterialRedemption_linkedActivityId_key`(`linkedActivityId`),
    INDEX `MaterialRedemption_status_exchangeStartAt_exchangeEndAt_idx`(`status`, `exchangeStartAt`, `exchangeEndAt`),
    INDEX `MaterialRedemption_createdByAdminId_createdAt_idx`(`createdByAdminId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaterialRedemptionRule` (
    `id` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `type` ENUM('NONE', 'ACTIVITY_REGISTRATION_REQUIRED', 'REGISTER_DAYS', 'CHECKIN_TOTAL', 'CHECKIN_STREAK', 'HAS_BADGE', 'ATTENDED_CONCERT', 'SPECIFIC_USER') NOT NULL,
    `operator` ENUM('GTE', 'EQ', 'LTE') NOT NULL DEFAULT 'GTE',
    `value` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MaterialRedemptionRule_materialId_sortOrder_idx`(`materialId`, `sortOrder`),
    INDEX `MaterialRedemptionRule_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaterialRedemptionOrder` (
    `id` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unitCost` INTEGER NOT NULL,
    `totalCost` INTEGER NOT NULL,
    `status` ENUM('SUCCESS', 'REDEEMED', 'CANCELLED', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'SUCCESS',
    `source` ENUM('MANUAL', 'ACTIVITY_REGISTRATION_AUTO') NOT NULL DEFAULT 'MANUAL',
    `redeemCode` VARCHAR(64) NOT NULL,
    `redeemToken` VARCHAR(128) NOT NULL,
    `eligibilitySnapshot` JSON NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `redeemedAt` DATETIME(3) NULL,
    `redeemedByAdminId` VARCHAR(191) NULL,
    `expiredAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledByAdminId` VARCHAR(191) NULL,
    `refundedAt` DATETIME(3) NULL,
    `refundedByAdminId` VARCHAR(191) NULL,
    `refundReason` VARCHAR(500) NULL,
    `linkedActivityId` VARCHAR(191) NULL,
    `redemptionSource` ENUM('MANUAL', 'ACTIVITY_CHECK_IN', 'ACTIVITY_AUTO_CHECK_IN') NULL,

    UNIQUE INDEX `MaterialRedemptionOrder_redeemCode_key`(`redeemCode`),
    UNIQUE INDEX `MaterialRedemptionOrder_redeemToken_key`(`redeemToken`),
    UNIQUE INDEX `MaterialRedemptionOrder_idempotencyKey_key`(`idempotencyKey`),
    INDEX `MaterialRedemptionOrder_materialId_createdAt_idx`(`materialId`, `createdAt`),
    INDEX `MaterialRedemptionOrder_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `MaterialRedemptionOrder_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `MaterialRedemptionOrder_linkedActivityId_createdAt_idx`(`linkedActivityId`, `createdAt`),
    INDEX `MaterialRedemptionOrder_source_status_idx`(`source`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    UNIQUE INDEX `UserReward_transactionId_key`(`transactionId`),
    INDEX `UserReward_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `UserReward_operatorId_createdAt_idx`(`operatorId`, `createdAt`),
    INDEX `UserReward_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Announcement_isPublished_isPinned_idx`(`isPublished`, `isPinned`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BadgeSeries` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `completionRewardBadgeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BadgeSeries_code_key`(`code`),
    INDEX `BadgeSeries_isEnabled_sortOrder_idx`(`isEnabled`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Badge` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(500) NULL,
    `acquisitionDescription` VARCHAR(500) NULL,
    `acquisitionDescriptionCustomized` BOOLEAN NOT NULL DEFAULT false,
    `iconUrl` VARCHAR(191) NULL,
    `pointsCost` INTEGER NULL,
    `category` ENUM('SYSTEM', 'BIRTHDAY', 'CONCERT') NOT NULL DEFAULT 'SYSTEM',
    `visibility` ENUM('PUBLIC', 'HIDDEN', 'SECRET') NOT NULL DEFAULT 'PUBLIC',
    `rarity` ENUM('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'LIMITED') NOT NULL DEFAULT 'COMMON',
    `grantType` ENUM('AUTO', 'MANUAL', 'EVENT') NOT NULL DEFAULT 'MANUAL',
    `isWearable` BOOLEAN NOT NULL DEFAULT true,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `effectType` ENUM('NONE', 'SHINE', 'GLOW', 'SPARKLE') NOT NULL DEFAULT 'NONE',
    `nicknameEffect` ENUM('NONE', 'COLOR', 'GOLD', 'GRADIENT', 'GLOW') NOT NULL DEFAULT 'NONE',
    `nicknameColor` VARCHAR(20) NULL,
    `nicknameGradientStart` VARCHAR(20) NULL,
    `nicknameGradientEnd` VARCHAR(20) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `seriesId` VARCHAR(191) NULL,
    `tierGroupCode` VARCHAR(64) NULL,
    `tierLevel` INTEGER NULL,
    `availableFrom` DATETIME(3) NULL,
    `availableUntil` DATETIME(3) NULL,
    `announceOnGrant` BOOLEAN NOT NULL DEFAULT false,
    `countsTowardSeriesCompletion` BOOLEAN NOT NULL DEFAULT true,
    `musicTourId` VARCHAR(191) NULL,
    `isAutoGrant` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Badge_name_key`(`name`),
    UNIQUE INDEX `Badge_slug_key`(`slug`),
    UNIQUE INDEX `Badge_code_key`(`code`),
    INDEX `Badge_isActive_idx`(`isActive`),
    INDEX `Badge_isEnabled_idx`(`isEnabled`),
    INDEX `Badge_category_idx`(`category`),
    INDEX `Badge_musicTourId_idx`(`musicTourId`),
    INDEX `Badge_visibility_isEnabled_sortOrder_idx`(`visibility`, `isEnabled`, `sortOrder`),
    INDEX `Badge_grantType_idx`(`grantType`),
    INDEX `Badge_rarity_idx`(`rarity`),
    INDEX `Badge_seriesId_sortOrder_idx`(`seriesId`, `sortOrder`),
    INDEX `Badge_availableFrom_availableUntil_idx`(`availableFrom`, `availableUntil`),
    UNIQUE INDEX `Badge_tierGroupCode_tierLevel_key`(`tierGroupCode`, `tierLevel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BadgeRule` (
    `id` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,
    `ruleType` ENUM('POST_COUNT', 'FEATURED_POST_COUNT', 'CHECKIN_TOTAL_DAYS', 'CHECKIN_STREAK', 'ACCOUNT_AGE_DAYS', 'FRIEND_COUNT', 'FOLLOWER_COUNT', 'GUESS_SONG_MAX_STREAK', 'DUEL_WIN_COUNT', 'WANT_LISTEN_MAX_STREAK', 'CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED', 'RATING_COUNT', 'BADGE_SERIES_COMPLETE') NOT NULL,
    `operator` ENUM('GTE', 'LTE', 'EQ') NOT NULL DEFAULT 'GTE',
    `threshold` INTEGER NULL,
    `secondaryThreshold` INTEGER NULL,
    `configJson` JSON NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BadgeRule_badgeId_key`(`badgeId`),
    INDEX `BadgeRule_ruleType_isEnabled_idx`(`ruleType`, `isEnabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Banner` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `link` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Banner_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BirthdayMessage` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL DEFAULT '🎂 生日纪念',
    `content` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BirthdayMessage_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TodayEvent` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `month` INTEGER NOT NULL,
    `day` INTEGER NOT NULL,
    `type` ENUM('ALBUM', 'SONG', 'CAREER', 'CUSTOM', 'BIRTHDAY', 'DEBUT', 'ROOKIE_CONTEST', 'ALBUM_RELEASE', 'CONCERT', 'AWARD', 'OTHER') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `source` ENUM('AUTO', 'ADMIN') NOT NULL DEFAULT 'ADMIN',
    `reference` VARCHAR(191) NULL,
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

-- CreateTable
CREATE TABLE `UserDailyMusicRecommendation` (
    `id` VARCHAR(191) NOT NULL,
    `recommendDate` VARCHAR(191) NOT NULL,
    `anonymousId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NULL,
    `songId` VARCHAR(191) NOT NULL,

    INDEX `UserDailyMusicRecommendation_recommendDate_idx`(`recommendDate`),
    INDEX `UserDailyMusicRecommendation_songId_recommendDate_idx`(`songId`, `recommendDate`),
    UNIQUE INDEX `UserDailyMusicRecommendation_userId_recommendDate_key`(`userId`, `recommendDate`),
    UNIQUE INDEX `UserDailyMusicRecommendation_anonymousId_recommendDate_key`(`anonymousId`, `recommendDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Block` (
    `id` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `blockerId` VARCHAR(191) NOT NULL,
    `blockedId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Block_blockerId_blockedId_key`(`blockerId`, `blockedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Board` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `postCount` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `coverUrl` VARCHAR(191) NULL,
    `followerCount` INTEGER NOT NULL DEFAULT 0,
    `isHot` BOOLEAN NOT NULL DEFAULT false,
    `isRecommended` BOOLEAN NOT NULL DEFAULT false,
    `parentId` VARCHAR(191) NULL,

    UNIQUE INDEX `Board_name_key`(`name`),
    UNIQUE INDEX `Board_slug_key`(`slug`),
    INDEX `Board_categoryId_idx`(`categoryId`),
    INDEX `Board_isActive_idx`(`isActive`),
    INDEX `Board_isHot_idx`(`isHot`),
    INDEX `Board_isRecommended_idx`(`isRecommended`),
    INDEX `Board_parentId_idx`(`parentId`),
    INDEX `Board_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BoardCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BoardCategory_name_key`(`name`),
    UNIQUE INDEX `BoardCategory_slug_key`(`slug`),
    INDEX `BoardCategory_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BoardFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `boardId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `BoardFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `BoardFavorite_boardId_userId_key`(`boardId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Changelog` (
    `id` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `major` INTEGER NOT NULL,
    `minor` INTEGER NOT NULL,
    `patch` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `type` ENUM('FEATURE', 'IMPROVEMENT', 'FIX', 'SECURITY', 'CONTENT') NOT NULL,
    `isMajor` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('DRAFT', 'PUBLISHED', 'UNPUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Changelog_version_key`(`version`),
    INDEX `Changelog_createdById_createdAt_idx`(`createdById`, `createdAt`),
    INDEX `Changelog_major_minor_patch_idx`(`major`, `minor`, `patch`),
    INDEX `Changelog_status_publishedAt_idx`(`status`, `publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CheckIn` (
    `id` VARCHAR(191) NOT NULL,
    `checkDate` DATETIME(3) NOT NULL,
    `points` INTEGER NOT NULL DEFAULT 10,
    `streakDay` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `isMakeUp` BOOLEAN NOT NULL DEFAULT false,
    `type` ENUM('NORMAL', 'MAKEUP_FREE_QUIZ', 'MAKEUP_PAID', 'MAKEUP_ADMIN') NOT NULL DEFAULT 'NORMAL',
    `madeUpAt` DATETIME(3) NULL,
    `makeupCost` INTEGER NULL,
    `challengeId` VARCHAR(191) NULL,
    `exp` INTEGER NOT NULL DEFAULT 0,
    `message` VARCHAR(191) NULL,
    `mood` VARCHAR(191) NULL,
    `moodType` VARCHAR(16) NULL,
    `moodEmoji` VARCHAR(32) NULL,
    `moodText` VARCHAR(191) NULL,
    `checkinDateKey` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `CheckIn_challengeId_key`(`challengeId`),
    INDEX `CheckIn_checkDate_idx`(`checkDate`),
    INDEX `CheckIn_checkinDateKey_mood_idx`(`checkinDateKey`, `mood`),
    INDEX `CheckIn_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `CheckIn_userId_type_checkinDateKey_idx`(`userId`, `type`, `checkinDateKey`),
    UNIQUE INDEX `CheckIn_userId_checkDate_key`(`userId`, `checkDate`),
    UNIQUE INDEX `CheckIn_userId_checkinDateKey_key`(`userId`, `checkinDateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MakeupChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `targetDate` DATETIME(3) NOT NULL,
    `targetDateKey` VARCHAR(191) NOT NULL,
    `monthKey` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `correctOptionId` VARCHAR(191) NOT NULL,
    `options` JSON NOT NULL,
    `audioStoragePath` VARCHAR(191) NOT NULL,
    `playbackSeconds` INTEGER NOT NULL DEFAULT 10,
    `status` ENUM('PENDING', 'CORRECT', 'WRONG') NOT NULL DEFAULT 'PENDING',
    `selectedOptionId` VARCHAR(191) NULL,
    `answeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MakeupChallenge_userId_status_idx`(`userId`, `status`),
    INDEX `MakeupChallenge_targetDateKey_idx`(`targetDateKey`),
    INDEX `MakeupChallenge_questionId_idx`(`questionId`),
    UNIQUE INDEX `MakeupChallenge_userId_monthKey_key`(`userId`, `monthKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CheckIn_backup_timezone_fix` (
    `id` VARCHAR(191) NULL,
    `checkDate` DATETIME(3) NULL,
    `points` INTEGER NULL,
    `streakDay` INTEGER NULL,
    `createdAt` DATETIME(3) NULL,
    `userId` VARCHAR(191) NULL,
    `isMakeUp` BOOLEAN NULL,
    `exp` INTEGER NULL,
    `message` VARCHAR(191) NULL,
    `mood` VARCHAR(191) NULL,
    `checkinDateKey` VARCHAR(191) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CheckIn_before_duplicate_fix` (
    `id` VARCHAR(191) NULL,
    `checkDate` DATETIME(3) NULL,
    `points` INTEGER NULL,
    `streakDay` INTEGER NULL,
    `createdAt` DATETIME(3) NULL,
    `userId` VARCHAR(191) NULL,
    `isMakeUp` BOOLEAN NULL,
    `exp` INTEGER NULL,
    `message` VARCHAR(191) NULL,
    `mood` VARCHAR(191) NULL,
    `checkinDateKey` VARCHAR(191) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CheckIn_before_streak_fix` (
    `id` VARCHAR(191) NULL,
    `checkDate` DATETIME(3) NULL,
    `points` INTEGER NULL,
    `streakDay` INTEGER NULL,
    `createdAt` DATETIME(3) NULL,
    `userId` VARCHAR(191) NULL,
    `isMakeUp` BOOLEAN NULL,
    `exp` INTEGER NULL,
    `message` VARCHAR(191) NULL,
    `mood` VARCHAR(191) NULL,
    `checkinDateKey` VARCHAR(191) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `pairKey` VARCHAR(191) NULL,

    UNIQUE INDEX `Conversation_pairKey_key`(`pairKey`),
    INDEX `Conversation_lastMessageAt_idx`(`lastMessageAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationParticipant` (
    `id` VARCHAR(191) NOT NULL,
    `lastReadAt` DATETIME(3) NULL,
    `clearedAt` DATETIME(3) NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `isMuted` BOOLEAN NOT NULL DEFAULT false,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `conversationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `ConversationParticipant_userId_isDeleted_idx`(`userId`, `isDeleted`),
    UNIQUE INDEX `ConversationParticipant_conversationId_userId_key`(`conversationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CultureComment` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `ipRegion` VARCHAR(191) NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `CultureComment_itemId_createdAt_idx`(`itemId`, `createdAt`),
    INDEX `CultureComment_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CultureFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `itemId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `CultureFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `CultureFavorite_itemId_userId_key`(`itemId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CultureItem` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('SONG', 'ALBUM', 'FILM', 'LIVE') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(191) NULL,
    `coverUrl` VARCHAR(191) NULL,
    `releaseDate` DATETIME(3) NULL,
    `lyricist` VARCHAR(191) NULL,
    `composer` VARCHAR(191) NULL,
    `arranger` VARCHAR(191) NULL,
    `albumName` VARCHAR(191) NULL,
    `roleName` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `summary` VARCHAR(191) NULL,
    `background` VARCHAR(191) NULL,
    `legalExcerpt` VARCHAR(191) NULL,
    `mvUrl` VARCHAR(191) NULL,
    `liveUrl` VARCHAR(191) NULL,
    `trailerUrl` VARCHAR(191) NULL,
    `rating` DOUBLE NULL,
    `favoriteCount` INTEGER NOT NULL DEFAULT 0,
    `commentCount` INTEGER NOT NULL DEFAULT 0,
    `isVisible` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CultureItem_slug_key`(`slug`),
    INDEX `CultureItem_releaseDate_idx`(`releaseDate`),
    INDEX `CultureItem_type_isVisible_sortOrder_idx`(`type`, `isVisible`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyExperienceRecord` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `amount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `DailyExperienceRecord_date_idx`(`date`),
    UNIQUE INDEX `DailyExperienceRecord_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyMessage` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `mood` VARCHAR(191) NULL,
    `moodType` VARCHAR(16) NULL,
    `moodEmoji` VARCHAR(32) NULL,
    `moodText` VARCHAR(191) NULL,
    `content` VARCHAR(191) NOT NULL,
    `ipRegion` VARCHAR(191) NULL,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `commentCount` INTEGER NOT NULL DEFAULT 0,
    `favoriteCount` INTEGER NOT NULL DEFAULT 0,
    `shareCount` INTEGER NOT NULL DEFAULT 0,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `isFeatured` BOOLEAN NOT NULL DEFAULT false,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `moderationStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VIOLATION') NOT NULL DEFAULT 'APPROVED',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `isAdminMessage` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `checkInId` VARCHAR(191) NULL,

    UNIQUE INDEX `DailyMessage_checkInId_key`(`checkInId`),
    INDEX `DailyMessage_date_createdAt_idx`(`date`, `createdAt`),
    INDEX `DailyMessage_date_likeCount_idx`(`date`, `likeCount`),
    INDEX `DailyMessage_hot_idx`(`date`, `isDeleted`, `isPinned`, `isFeatured`, `likeCount`, `commentCount`, `createdAt`),
    INDEX `DailyMessage_isDeleted_idx`(`isDeleted`),
    INDEX `DailyMessage_isPinned_isFeatured_idx`(`isPinned`, `isFeatured`),
    INDEX `DailyMessage_latest_idx`(`date`, `isDeleted`, `isPinned`, `isFeatured`, `createdAt`),
    INDEX `DailyMessage_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `DailyMessage_date_isAdminMessage_sort_createdAt_idx`(`date`, `isAdminMessage`, `sort`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyMessageComment` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `ipRegion` VARCHAR(191) NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,

    INDEX `DailyMessageComment_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `DailyMessageComment_messageId_createdAt_idx`(`messageId`, `createdAt`),
    INDEX `DailyMessageComment_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyMessageFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `DailyMessageFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `DailyMessageFavorite_messageId_userId_key`(`messageId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyMessageLike` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `DailyMessageLike_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `DailyMessageLike_messageId_userId_key`(`messageId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyQuote` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NULL,
    `songTitle` VARCHAR(191) NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `isVisible` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DailyQuote_isPinned_isVisible_idx`(`isPinned`, `isVisible`),
    INDEX `DailyQuote_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyTaskProgress` (
    `id` VARCHAR(191) NOT NULL,
    `taskDate` DATETIME(3) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `isCompleted` BOOLEAN NOT NULL DEFAULT false,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,

    INDEX `DailyTaskProgress_taskDate_isCompleted_idx`(`taskDate`, `isCompleted`),
    UNIQUE INDEX `DailyTaskProgress_userId_templateId_taskDate_key`(`userId`, `templateId`, `taskDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyTaskTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `target` INTEGER NOT NULL DEFAULT 1,
    `points` INTEGER NOT NULL DEFAULT 0,
    `exp` INTEGER NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DailyTaskTemplate_key_key`(`key`),
    INDEX `DailyTaskTemplate_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DirectMessage` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('TEXT', 'IMAGE', 'EMOJI', 'SYSTEM', 'STICKER') NOT NULL DEFAULT 'TEXT',
    `content` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `stickerId` VARCHAR(191) NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `conversationId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `clientMessageId` VARCHAR(191) NULL,

    INDEX `DirectMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `DirectMessage_senderId_createdAt_idx`(`senderId`, `createdAt`),
    INDEX `DirectMessage_stickerId_idx`(`stickerId`),
    UNIQUE INDEX `DirectMessage_senderId_clientMessageId_key`(`senderId`, `clientMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailVerification` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `EmailVerification_tokenHash_key`(`tokenHash`),
    INDEX `EmailVerification_email_idx`(`email`),
    INDEX `EmailVerification_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EHospitalCheckConfig` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `questionCount` INTEGER NOT NULL DEFAULT 10,
    `audioSeconds` INTEGER NOT NULL DEFAULT 7,
    `passScore` INTEGER NOT NULL DEFAULT 60,
    `dailyLimit` INTEGER NOT NULL DEFAULT 3,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EHospitalCheckSession` (
    `id` VARCHAR(191) NOT NULL,
    `questions` JSON NOT NULL,
    `answers` JSON NULL,
    `score` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `registrationDraftId` VARCHAR(191) NOT NULL,

    INDEX `EHospitalCheckSession_registrationDraftId_status_createdAt_idx`(`registrationDraftId`, `status`, `createdAt`),
    INDEX `EHospitalCheckSession_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EHospitalCheckAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL,
    `passed` BOOLEAN NOT NULL,
    `ip` VARCHAR(191) NULL,
    `identityHash` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `registrationDraftId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EHospitalCheckAttempt_sessionId_key`(`sessionId`),
    INDEX `EHospitalCheckAttempt_identityHash_createdAt_idx`(`identityHash`, `createdAt`),
    INDEX `EHospitalCheckAttempt_registrationDraftId_createdAt_idx`(`registrationDraftId`, `createdAt`),
    INDEX `EHospitalCheckAttempt_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegistrationDraft` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `registrationType` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `usernameNormalized` VARCHAR(191) NOT NULL,
    `nickname` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `securityQuestions` JSON NULL,
    `acceptedAgreement` BOOLEAN NOT NULL DEFAULT false,
    `identityHash` VARCHAR(191) NOT NULL,
    `phoneCodeHash` VARCHAR(191) NULL,
    `phoneCodeExpiresAt` DATETIME(3) NULL,
    `phoneVerifiedAt` DATETIME(3) NULL,
    `emailCodeHash` VARCHAR(191) NULL,
    `emailCodeExpiresAt` DATETIME(3) NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RegistrationDraft_tokenHash_key`(`tokenHash`),
    INDEX `RegistrationDraft_email_idx`(`email`),
    INDEX `RegistrationDraft_phone_idx`(`phone`),
    INDEX `RegistrationDraft_identityHash_createdAt_idx`(`identityHash`, `createdAt`),
    INDEX `RegistrationDraft_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EntertainmentDailyDraw` (
    `id` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(191) NOT NULL,
    `points` INTEGER NOT NULL,
    `prescriptionCode` VARCHAR(191) NOT NULL,
    `lyricText` VARCHAR(191) NULL,
    `songTitle` VARCHAR(191) NULL,
    `albumTitle` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `lyricPrescriptionId` VARCHAR(191) NULL,

    UNIQUE INDEX `EntertainmentDailyDraw_prescriptionCode_key`(`prescriptionCode`),
    INDEX `EntertainmentDailyDraw_dateKey_idx`(`dateKey`),
    INDEX `EntertainmentDailyDraw_lyricPrescriptionId_idx`(`lyricPrescriptionId`),
    INDEX `EntertainmentDailyDraw_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `EntertainmentDailyDraw_userId_idx`(`userId`),
    UNIQUE INDEX `EntertainmentDailyDraw_userId_dateKey_key`(`userId`, `dateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExperienceLog` (
    `id` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `type` ENUM('CHECKIN', 'TASK', 'POST', 'COMMENT', 'LIKE', 'ACTIVITY', 'ADMIN', 'OTHER') NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(191) NULL,
    `sourceId` VARCHAR(191) NULL,

    INDEX `ExperienceLog_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `ExperienceLog_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `ExperienceLog_sourceType_sourceId_key`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Feedback` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('BUG', 'SUGGESTION', 'CONTENT', 'ACCOUNT', 'OTHER', 'EXPERIENCE') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `status` ENUM('OPEN', 'REPLIED', 'CLOSED', 'PROCESSING', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NULL,
    `adminUnread` BOOLEAN NOT NULL DEFAULT true,
    `userUnread` BOOLEAN NOT NULL DEFAULT false,
    `lastReplyAt` DATETIME(3) NULL,
    `lastUserReplyAt` DATETIME(3) NULL,
    `lastAdminReplyAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `idempotencyKeyHash` VARCHAR(191) NULL,

    UNIQUE INDEX `Feedback_idempotencyKeyHash_key`(`idempotencyKeyHash`),
    INDEX `Feedback_adminUnread_updatedAt_idx`(`adminUnread`, `updatedAt`),
    INDEX `Feedback_lastReplyAt_idx`(`lastReplyAt`),
    INDEX `Feedback_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Feedback_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedbackAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `feedbackId` VARCHAR(191) NOT NULL,
    `replyId` VARCHAR(191) NULL,

    INDEX `FeedbackAttachment_feedbackId_idx`(`feedbackId`),
    INDEX `FeedbackAttachment_replyId_idx`(`replyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedbackReply` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `feedbackId` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `authorRole` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `isReadByUser` BOOLEAN NOT NULL DEFAULT false,
    `isReadByAdmin` BOOLEAN NOT NULL DEFAULT true,

    INDEX `FeedbackReply_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `FeedbackReply_feedbackId_createdAt_idx`(`feedbackId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Follow` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `followerId` VARCHAR(191) NOT NULL,
    `followingId` VARCHAR(191) NOT NULL,

    INDEX `Follow_followingId_createdAt_idx`(`followingId`, `createdAt`),
    UNIQUE INDEX `Follow_followerId_followingId_key`(`followerId`, `followingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FriendActivity` (
    `id` VARCHAR(191) NOT NULL,
    `mood` VARCHAR(191) NULL,
    `moodType` VARCHAR(16) NULL,
    `moodEmoji` VARCHAR(32) NULL,
    `moodText` VARCHAR(191) NULL,
    `content` VARCHAR(191) NULL,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorId` VARCHAR(191) NOT NULL,
    `checkInId` VARCHAR(191) NULL,
    `dailyMessageId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'CHECKIN',
    `targetUrl` VARCHAR(191) NULL,

    INDEX `FriendActivity_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `FriendActivity_checkInId_idx`(`checkInId`),
    INDEX `FriendActivity_dailyMessageId_idx`(`dailyMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FriendRequest` (
    `id` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,

    INDEX `FriendRequest_receiverId_status_createdAt_idx`(`receiverId`, `status`, `createdAt`),
    INDEX `FriendRequest_senderId_status_createdAt_idx`(`senderId`, `status`, `createdAt`),
    UNIQUE INDEX `FriendRequest_senderId_receiverId_status_key`(`senderId`, `receiverId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Friendship` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userAId` VARCHAR(191) NOT NULL,
    `userBId` VARCHAR(191) NOT NULL,

    INDEX `Friendship_userBId_createdAt_idx`(`userBId`, `createdAt`),
    UNIQUE INDEX `Friendship_userAId_userBId_key`(`userAId`, `userBId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FriendFollow` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `followerId` VARCHAR(191) NOT NULL,
    `followedId` VARCHAR(191) NOT NULL,

    INDEX `FriendFollow_followerId_createdAt_idx`(`followerId`, `createdAt`),
    INDEX `FriendFollow_followedId_idx`(`followedId`),
    UNIQUE INDEX `FriendFollow_followerId_followedId_key`(`followerId`, `followedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FriendRemark` (
    `id` VARCHAR(191) NOT NULL,
    `remark` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `friendId` VARCHAR(191) NOT NULL,

    INDEX `FriendRemark_friendId_idx`(`friendId`),
    UNIQUE INDEX `FriendRemark_ownerId_friendId_key`(`ownerId`, `friendId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FriendGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(30) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,

    INDEX `FriendGroup_ownerId_sortOrder_createdAt_idx`(`ownerId`, `sortOrder`, `createdAt`),
    UNIQUE INDEX `FriendGroup_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FriendGroupMember` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ownerId` VARCHAR(191) NOT NULL,
    `friendId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,

    INDEX `FriendGroupMember_groupId_idx`(`groupId`),
    INDEX `FriendGroupMember_friendId_idx`(`friendId`),
    UNIQUE INDEX `FriendGroupMember_ownerId_friendId_key`(`ownerId`, `friendId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GrowthLevelConfig` (
    `id` VARCHAR(191) NOT NULL,
    `level` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `requiredExp` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GrowthLevelConfig_level_key`(`level`),
    INDEX `GrowthLevelConfig_requiredExp_idx`(`requiredExp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongAudioVariant` (
    `id` VARCHAR(191) NOT NULL,
    `durationSeconds` INTEGER NOT NULL,
    `storagePath` VARCHAR(191) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `purpose` ENUM('GAME', 'REGISTER_CHECK') NOT NULL DEFAULT 'GAME',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `questionId` VARCHAR(191) NOT NULL,

    INDEX `GuessSongAudioVariant_questionId_purpose_idx`(`questionId`, `purpose`),
    UNIQUE INDEX `GuessSongAudioVariant_questionId_durationSeconds_purpose_key`(`questionId`, `durationSeconds`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongLeaderboardEntry` (
    `id` VARCHAR(191) NOT NULL,
    `mode` ENUM('EASY', 'ADVANCED', 'HARD', 'EXPERT', 'ENDLESS') NOT NULL,
    `periodType` ENUM('WEEK', 'MONTH') NOT NULL,
    `periodKey` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL,
    `correctCount` INTEGER NOT NULL,
    `maxStreak` INTEGER NOT NULL,
    `totalPlayCount` INTEGER NOT NULL,
    `achievedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,

    INDEX `GuessSongLeaderboardEntry_periodType_periodKey_mode_score_idx`(`periodType`, `periodKey`, `mode`, `score`),
    INDEX `GuessSongLeaderboardEntry_sessionId_idx`(`sessionId`),
    INDEX `GuessSongLeaderboardEntry_userId_periodType_periodKey_idx`(`userId`, `periodType`, `periodKey`),
    UNIQUE INDEX `GuessSongLeaderboardEntry_userId_mode_periodType_periodKey_key`(`userId`, `mode`, `periodType`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WantListenFakeTitle` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `normalizedTitle` VARCHAR(191) NOT NULL,
    `difficulty` ENUM('EASY', 'NORMAL', 'HARD') NOT NULL DEFAULT 'NORMAL',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `usageCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WantListenFakeTitle_normalizedTitle_key`(`normalizedTitle`),
    INDEX `WantListenFakeTitle_enabled_difficulty_createdAt_idx`(`enabled`, `difficulty`, `createdAt`),
    INDEX `WantListenFakeTitle_title_idx`(`title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WantListenSession` (
    `id` VARCHAR(191) NOT NULL,
    `activeKey` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `mode` ENUM('WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE') NOT NULL,
    `status` ENUM('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'EXPIRED') NOT NULL DEFAULT 'IN_PROGRESS',
    `currentQuestion` INTEGER NOT NULL DEFAULT 1,
    `questionCount` INTEGER NULL,
    `totalQuestions` INTEGER NOT NULL DEFAULT 0,
    `currentStreak` INTEGER NOT NULL DEFAULT 0,
    `maxStreak` INTEGER NOT NULL DEFAULT 0,
    `wrongCount` INTEGER NOT NULL DEFAULT 0,
    `livesRemaining` INTEGER NOT NULL DEFAULT 3,
    `score` INTEGER NOT NULL DEFAULT 0,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `completionTimeMs` INTEGER NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `antiCheatStatus` ENUM('CLEAN', 'SUSPICIOUS', 'CHEAT_DETECTED') NOT NULL DEFAULT 'CLEAN',
    `antiCheatReasons` JSON NULL,
    `excludedFromLeaderboard` BOOLEAN NOT NULL DEFAULT false,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WantListenSession_activeKey_key`(`activeKey`),
    INDEX `WantListenSession_userId_mode_status_idx`(`userId`, `mode`, `status`),
    INDEX `WantListenSession_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `WantListenSession_mode_status_completedAt_idx`(`mode`, `status`, `completedAt`),
    INDEX `WantListenSession_userId_completedAt_idx`(`userId`, `completedAt`),
    INDEX `WantListenSession_createdAt_userId_idx`(`createdAt`, `userId`),
    INDEX `WantListenSession_antiCheatStatus_status_completedAt_idx`(`antiCheatStatus`, `status`, `completedAt`),
    INDEX `WantListenSession_excludedFromLeaderboard_status_completedAt_idx`(`excludedFromLeaderboard`, `status`, `completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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
    `questionStartedAt` DATETIME(3) NULL,
    `answerLatencyMs` INTEGER NULL,
    `answeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sessionId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `WantListenSessionQuestion_publicId_key`(`publicId`),
    INDEX `WantListenSessionQuestion_sessionId_answeredAt_idx`(`sessionId`, `answeredAt`),
    INDEX `WantListenSessionQuestion_sessionId_position_idx`(`sessionId`, `position`),
    INDEX `WantListenSessionQuestion_sessionId_questionStartedAt_idx`(`sessionId`, `questionStartedAt`),
    UNIQUE INDEX `WantListenSessionQuestion_sessionId_position_key`(`sessionId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `WantListenStats_mode_bestScore_idx`(`mode`, `bestScore`),
    INDEX `WantListenStats_userId_updatedAt_idx`(`userId`, `updatedAt`),
    UNIQUE INDEX `WantListenStats_userId_mode_key`(`userId`, `mode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WantListenLeaderboardEntry` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `mode` ENUM('WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE') NOT NULL,
    `periodType` ENUM('DAY', 'WEEK', 'ALL') NOT NULL,
    `periodKey` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL,
    `correctCount` INTEGER NOT NULL,
    `maxStreak` INTEGER NOT NULL DEFAULT 0,
    `totalQuestions` INTEGER NOT NULL DEFAULT 0,
    `completionTimeMs` INTEGER NOT NULL,
    `achievedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WantListenLeaderboard_mode_period_score_time_idx`(`mode`, `periodType`, `periodKey`, `score`, `correctCount`, `completionTimeMs`),
    INDEX `WantListenLeaderboard_endless_sort_idx`(`mode`, `periodType`, `periodKey`, `score`, `correctCount`, `maxStreak`, `completionTimeMs`),
    INDEX `WantListenLeaderboardEntry_userId_periodType_periodKey_idx`(`userId`, `periodType`, `periodKey`),
    INDEX `WantListenLeaderboardEntry_sessionId_idx`(`sessionId`),
    UNIQUE INDEX `WantListenLeaderboardEntry_userId_mode_periodType_periodKey_key`(`userId`, `mode`, `periodType`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `UndercoverWordPair_enabled_difficulty_category_createdAt_idx`(`enabled`, `difficulty`, `category`, `createdAt`),
    INDEX `UndercoverWordPair_enabled_usageCount_idx`(`enabled`, `usageCount`),
    INDEX `UndercoverWordPair_civilianWord_idx`(`civilianWord`),
    INDEX `UndercoverWordPair_undercoverWord_idx`(`undercoverWord`),
    UNIQUE INDEX `UndercoverWordPair_normalized_pair_key`(`normalizedCivilianWord`, `normalizedUndercoverWord`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UndercoverRoom` (
    `id` VARCHAR(191) NOT NULL,
    `roomCode` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('WAITING', 'PLAYING', 'FINISHED', 'CANCELLED') NOT NULL DEFAULT 'WAITING',
    `difficulty` ENUM('EASY', 'NORMAL', 'HARD') NOT NULL DEFAULT 'NORMAL',
    `currentMatchId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    `hostId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `UndercoverRoom_roomCode_key`(`roomCode`),
    INDEX `UndercoverRoom_status_isPublic_lastActivityAt_idx`(`status`, `isPublic`, `lastActivityAt`),
    INDEX `UndercoverRoom_hostId_status_idx`(`hostId`, `status`),
    INDEX `UndercoverRoom_currentMatchId_idx`(`currentMatchId`),
    INDEX `UndercoverRoom_lastActivityAt_idx`(`lastActivityAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UndercoverRoomPlayer` (
    `id` VARCHAR(191) NOT NULL,
    `isReady` BOOLEAN NOT NULL DEFAULT false,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `leftAt` DATETIME(3) NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `UndercoverRoomPlayer_userId_leftAt_idx`(`userId`, `leftAt`),
    INDEX `UndercoverRoomPlayer_roomId_leftAt_joinedAt_idx`(`roomId`, `leftAt`, `joinedAt`),
    UNIQUE INDEX `UndercoverRoomPlayer_roomId_userId_key`(`roomId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UndercoverMatch` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('PLAYING', 'FINISHED', 'CANCELLED') NOT NULL DEFAULT 'PLAYING',
    `phase` ENUM('ROLE_REVEAL', 'DESCRIBING', 'THINKING', 'VOTING', 'TIE_VOTING', 'UNDERCOVER_GUESS', 'FINISHED') NOT NULL DEFAULT 'ROLE_REVEAL',
    `finishReason` ENUM('UNDERCOVER_SURVIVAL', 'UNDERCOVER_GUESS_CORRECT', 'UNDERCOVER_GUESS_WRONG', 'UNDERCOVER_GUESS_TIMEOUT', 'UNDERCOVER_EXIT') NULL,
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
    `matchNumber` INTEGER NOT NULL DEFAULT 1,
    `difficulty` ENUM('EASY', 'NORMAL', 'HARD') NOT NULL DEFAULT 'NORMAL',
    `wordPairId` VARCHAR(191) NOT NULL,

    INDEX `UndercoverMatch_status_phase_phaseDeadline_idx`(`status`, `phase`, `phaseDeadline`),
    INDEX `UndercoverMatch_roomId_status_idx`(`roomId`, `status`),
    INDEX `UndercoverMatch_status_finishedAt_idx`(`status`, `finishedAt`),
    INDEX `UndercoverMatch_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `UndercoverMatchPlayer_matchId_isAlive_idx`(`matchId`, `isAlive`),
    INDEX `UndercoverMatchPlayer_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `UndercoverMatchPlayer_matchId_userId_key`(`matchId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UndercoverDescription` (
    `id` VARCHAR(191) NOT NULL,
    `round` INTEGER NOT NULL,
    `content` VARCHAR(120) NOT NULL,
    `isAuto` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `matchId` VARCHAR(191) NOT NULL,
    `matchPlayerId` VARCHAR(191) NOT NULL,

    INDEX `UndercoverDescription_matchId_round_createdAt_idx`(`matchId`, `round`, `createdAt`),
    UNIQUE INDEX `UndercoverDescription_matchId_round_matchPlayerId_key`(`matchId`, `round`, `matchPlayerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UndercoverVote` (
    `id` VARCHAR(191) NOT NULL,
    `round` INTEGER NOT NULL,
    `stage` ENUM('MAIN', 'TIE') NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `isAbstain` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `matchId` VARCHAR(191) NOT NULL,
    `voterId` VARCHAR(191) NOT NULL,

    INDEX `UndercoverVote_matchId_round_stage_targetId_idx`(`matchId`, `round`, `stage`, `targetId`),
    UNIQUE INDEX `UndercoverVote_matchId_round_stage_voterId_key`(`matchId`, `round`, `stage`, `voterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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
    `xp` INTEGER NOT NULL DEFAULT 0,
    `level` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `UndercoverStats_userId_key`(`userId`),
    INDEX `UndercoverStats_totalWins_userId_idx`(`totalWins`, `userId`),
    INDEX `UndercoverStats_totalGames_userId_idx`(`totalGames`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UndercoverRoomMessage` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(200) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `roomId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `UndercoverRoomMessage_roomId_createdAt_idx`(`roomId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UndercoverMatchResult` (
    `id` VARCHAR(191) NOT NULL,
    `role` ENUM('CIVILIAN', 'UNDERCOVER') NOT NULL,
    `isWin` BOOLEAN NOT NULL DEFAULT false,
    `xpAwarded` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `matchId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `UndercoverMatchResult_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `UndercoverMatchResult_matchId_userId_key`(`matchId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongPlayRequest` (
    `id` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(191) NOT NULL,
    `playCountAfter` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sessionQuestionId` VARCHAR(191) NOT NULL,
    `audioVariantId` VARCHAR(191) NOT NULL,

    INDEX `GuessSongPlayRequest_sessionQuestionId_createdAt_idx`(`sessionQuestionId`, `createdAt`),
    UNIQUE INDEX `GuessSongPlayRequest_sessionQuestionId_requestKey_key`(`sessionQuestionId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `songTitle` VARCHAR(191) NOT NULL,
    `albumTitle` VARCHAR(191) NULL,
    `difficulty` ENUM('EASY', 'ADVANCED', 'HARD') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `allowEndless` BOOLEAN NOT NULL DEFAULT true,
    `correctAnswer` VARCHAR(191) NOT NULL,
    `wrongOption1` VARCHAR(191) NOT NULL,
    `wrongOption2` VARCHAR(191) NOT NULL,
    `wrongOption3` VARCHAR(191) NOT NULL,
    `sourceAudioPath` VARCHAR(191) NULL,
    `audioDurationMs` INTEGER NULL,
    `processingStatus` ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `processingError` VARCHAR(191) NULL,
    `playCount` INTEGER NOT NULL DEFAULT 0,
    `answerCount` INTEGER NOT NULL DEFAULT 0,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `musicSongId` VARCHAR(191) NULL,
    `audioSourceType` VARCHAR(191) NULL,
    `musicSourceRevision` VARCHAR(191) NULL,
    `questionType` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',

    INDEX `GuessSongQuestion_allowEndless_enabled_idx`(`allowEndless`, `enabled`),
    INDEX `GuessSongQuestion_createdAt_idx`(`createdAt`),
    INDEX `GuessSongQuestion_difficulty_enabled_idx`(`difficulty`, `enabled`),
    INDEX `GuessSongQuestion_musicSongId_idx`(`musicSongId`),
    INDEX `GuessSongQuestion_processingStatus_idx`(`processingStatus`),
    INDEX `GuessSongQuestion_questionType_enabled_processingStatus_idx`(`questionType`, `enabled`, `processingStatus`),
    INDEX `GuessSongQuestion_songTitle_idx`(`songTitle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongSession` (
    `id` VARCHAR(191) NOT NULL,
    `activeKey` VARCHAR(191) NULL,
    `mode` ENUM('EASY', 'ADVANCED', 'HARD', 'EXPERT', 'ENDLESS') NOT NULL,
    `status` ENUM('IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ABANDONED', 'EXPIRED', 'CHEAT_DETECTED') NOT NULL DEFAULT 'IN_PROGRESS',
    `riskScore` INTEGER NOT NULL DEFAULT 0,
    `riskReasons` JSON NULL,
    `isValid` BOOLEAN NOT NULL DEFAULT true,
    `clientSessionNonce` VARCHAR(191) NULL,
    `clientSessionTokenIssuedAt` DATETIME(3) NULL,
    `invalidatedAt` DATETIME(3) NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `wrongCount` INTEGER NOT NULL DEFAULT 0,
    `currentStreak` INTEGER NOT NULL DEFAULT 0,
    `maxStreak` INTEGER NOT NULL DEFAULT 0,
    `livesRemaining` INTEGER NOT NULL DEFAULT 0,
    `totalPlayCount` INTEGER NOT NULL DEFAULT 0,
    `currentPosition` INTEGER NOT NULL DEFAULT 1,
    `questionCount` INTEGER NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `GuessSongSession_activeKey_key`(`activeKey`),
    INDEX `GuessSongSession_createdAt_idx`(`createdAt`),
    INDEX `GuessSongSession_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `GuessSongSession_userId_completedAt_idx`(`userId`, `completedAt`),
    INDEX `GuessSongSession_userId_mode_status_idx`(`userId`, `mode`, `status`),
    INDEX `GuessSongSession_riskScore_createdAt_idx`(`riskScore`, `createdAt`),
    INDEX `GuessSongSession_isValid_createdAt_idx`(`isValid`, `createdAt`),
    INDEX `GuessSongSession_year_leaderboard_idx`(`status`, `isValid`, `mode`, `questionCount`, `completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongSessionQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `publicId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `playbackDurationSeconds` INTEGER NOT NULL,
    `maxPlayCount` INTEGER NOT NULL,
    `playCount` INTEGER NOT NULL DEFAULT 0,
    `questionAttemptTokenHash` VARCHAR(191) NULL,
    `firstPlayedAt` DATETIME(3) NULL,
    `answerLatencyMs` INTEGER NULL,
    `optionsSnapshot` JSON NOT NULL,
    `correctOptionKey` VARCHAR(191) NOT NULL,
    `selectedOptionKey` VARCHAR(191) NULL,
    `isCorrect` BOOLEAN NULL,
    `awardedScore` INTEGER NOT NULL DEFAULT 0,
    `answerDeadlineAt` DATETIME(3) NULL,
    `answeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sessionId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `GuessSongSessionQuestion_publicId_key`(`publicId`),
    INDEX `GuessSongSessionQuestion_publicId_idx`(`publicId`),
    INDEX `GuessSongSessionQuestion_questionId_idx`(`questionId`),
    INDEX `GuessSongSessionQuestion_sessionId_answeredAt_idx`(`sessionId`, `answeredAt`),
    UNIQUE INDEX `GuessSongSessionQuestion_sessionId_position_key`(`sessionId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongQuizConfig` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'global',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expertEnabled` BOOLEAN NOT NULL DEFAULT true,
    `sourceType` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `albumId` VARCHAR(191) NULL,
    `year` INTEGER NULL,
    `difficulty` ENUM('EASY', 'ADVANCED', 'HARD') NOT NULL DEFAULT 'EASY',
    `questionCount` INTEGER NOT NULL DEFAULT 10,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongRiskLog` (
    `id` VARCHAR(191) NOT NULL,
    `mode` ENUM('EASY', 'ADVANCED', 'HARD', 'EXPERT', 'ENDLESS') NOT NULL,
    `score` INTEGER NOT NULL,
    `riskScore` INTEGER NOT NULL,
    `trigger` VARCHAR(191) NULL,
    `reasons` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,

    INDEX `GuessSongRiskLog_createdAt_idx`(`createdAt`),
    INDEX `GuessSongRiskLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `GuessSongRiskLog_riskScore_createdAt_idx`(`riskScore`, `createdAt`),
    INDEX `GuessSongRiskLog_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GameAntiCheatLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `gameType` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `questionCount` INTEGER NULL,
    `fastestAnswerTime` INTEGER NULL,
    `averageAnswerTime` INTEGER NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `suspiciousType` ENUM('FAST_ANSWER', 'REPEATED_SUBMIT', 'INVALID_SCORE', 'ANSWER_LEAK', 'ABNORMAL_PATTERN') NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GameAntiCheatLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `GameAntiCheatLog_gameType_createdAt_idx`(`gameType`, `createdAt`),
    INDEX `GameAntiCheatLog_suspiciousType_createdAt_idx`(`suspiciousType`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongDuelRoom` (
    `id` VARCHAR(191) NOT NULL,
    `roomCode` VARCHAR(191) NOT NULL,
    `mode` ENUM('SCORE', 'BUZZER') NOT NULL DEFAULT 'SCORE',
    `passwordHash` VARCHAR(191) NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('WAITING', 'READY', 'PLAYING', 'FINISHED', 'CLOSED') NOT NULL DEFAULT 'WAITING',
    `hostReady` BOOLEAN NOT NULL DEFAULT false,
    `challengerReady` BOOLEAN NOT NULL DEFAULT false,
    `hostLastSeenAt` DATETIME(3) NULL,
    `challengerLastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `challengerId` VARCHAR(191) NULL,

    UNIQUE INDEX `GuessSongDuelRoom_roomCode_key`(`roomCode`),
    INDEX `GuessSongDuelRoom_status_isPublic_createdAt_idx`(`status`, `isPublic`, `createdAt`),
    INDEX `GuessSongDuelRoom_hostId_status_idx`(`hostId`, `status`),
    INDEX `GuessSongDuelRoom_challengerId_status_idx`(`challengerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongDuelMatch` (
    `id` VARCHAR(191) NOT NULL,
    `mode` ENUM('SCORE', 'BUZZER') NOT NULL DEFAULT 'SCORE',
    `status` ENUM('PLAYING', 'FINISHED', 'INVALID', 'CLOSED') NOT NULL DEFAULT 'PLAYING',
    `finishReason` ENUM('SCORE_THRESHOLD', 'ALL_QUESTIONS', 'TIEBREAKER', 'DISCONNECT', 'FORFEIT', 'DISCONNECT_INVALID', 'FORFEIT_INVALID') NULL,
    `winnerId` VARCHAR(191) NULL,
    `isDraw` BOOLEAN NOT NULL DEFAULT false,
    `isSuspicious` BOOLEAN NOT NULL DEFAULT false,
    `currentQuestionIndex` INTEGER NOT NULL DEFAULT 1,
    `totalQuestions` INTEGER NOT NULL DEFAULT 30,
    `completedQuestionCount` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `rewardAmount` INTEGER NOT NULL DEFAULT 0,
    `rewardGranted` BOOLEAN NOT NULL DEFAULT false,
    `rewardReason` ENUM('NOT_APPLICABLE', 'PENDING', 'GRANTED', 'DAILY_LIMIT_REACHED', 'ALREADY_GRANTED_FOR_MATCH', 'REWARD_FAILED', 'NOT_ELIGIBLE') NOT NULL DEFAULT 'NOT_APPLICABLE',
    `rewardedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `GuessSongDuelMatch_roomId_key`(`roomId`),
    INDEX `GuessSongDuelMatch_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `GuessSongDuelMatch_winnerId_finishedAt_idx`(`winnerId`, `finishedAt`),
    INDEX `GuessSongDuelMatch_rewardReason_finishedAt_idx`(`rewardReason`, `finishedAt`),
    INDEX `GuessSongDuelMatch_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongDuelPlayer` (
    `id` VARCHAR(191) NOT NULL,
    `slot` INTEGER NOT NULL,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `totalEffectiveAnswerMs` INTEGER NOT NULL DEFAULT 0,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `lastSeenAt` DATETIME(3) NULL,
    `disconnectedAt` DATETIME(3) NULL,
    `reconnectDeadlineAt` DATETIME(3) NULL,
    `suspicious` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `matchId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `GuessSongDuelPlayer_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `GuessSongDuelPlayer_matchId_isOnline_idx`(`matchId`, `isOnline`),
    INDEX `GuessSongDuelPlayer_matchId_lastSeenAt_idx`(`matchId`, `lastSeenAt`),
    UNIQUE INDEX `GuessSongDuelPlayer_matchId_userId_key`(`matchId`, `userId`),
    UNIQUE INDEX `GuessSongDuelPlayer_matchId_slot_key`(`matchId`, `slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongDuelQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `publicToken` VARCHAR(191) NOT NULL,
    `questionIndex` INTEGER NOT NULL,
    `isOvertime` BOOLEAN NOT NULL DEFAULT false,
    `overtimeIndex` INTEGER NULL,
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

    UNIQUE INDEX `GuessSongDuelQuestion_publicToken_key`(`publicToken`),
    INDEX `GuessSongDuelQuestion_matchId_revealedAt_idx`(`matchId`, `revealedAt`),
    INDEX `GuessSongDuelQuestion_sourceQuestionId_idx`(`sourceQuestionId`),
    UNIQUE INDEX `GuessSongDuelQuestion_matchId_questionIndex_key`(`matchId`, `questionIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `GuessSongDuelAnswer_questionId_receivedAt_idx`(`questionId`, `receivedAt`),
    INDEX `GuessSongDuelAnswer_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `GuessSongDuelAnswer_suspicious_createdAt_idx`(`suspicious`, `createdAt`),
    UNIQUE INDEX `GuessSongDuelAnswer_matchId_questionId_userId_key`(`matchId`, `questionId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongDuelStats` (
    `id` VARCHAR(191) NOT NULL,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `participations` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `GuessSongDuelStats_userId_key`(`userId`),
    INDEX `GuessSongDuelStats_wins_userId_idx`(`wins`, `userId`),
    INDEX `GuessSongDuelStats_participations_userId_idx`(`participations`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuessSongDuelInvite` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `roomId` VARCHAR(191) NOT NULL,
    `inviterId` VARCHAR(191) NOT NULL,
    `inviteeId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `GuessSongDuelInvite_tokenHash_key`(`tokenHash`),
    INDEX `GuessSongDuelInvite_roomId_inviteeId_expiresAt_idx`(`roomId`, `inviteeId`, `expiresAt`),
    INDEX `GuessSongDuelInvite_inviteeId_acceptedAt_expiresAt_idx`(`inviteeId`, `acceptedAt`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Like` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `postId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `Like_postId_createdAt_idx`(`postId`, `createdAt`),
    INDEX `Like_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `Like_postId_userId_key`(`postId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginDevice` (
    `id` VARCHAR(191) NOT NULL,
    `deviceType` ENUM('WEB', 'MOBILE', 'TABLET', 'API') NOT NULL DEFAULT 'WEB',
    `deviceName` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `lastLoginAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,

    INDEX `LoginDevice_userId_lastLoginAt_idx`(`userId`, `lastLoginAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lottery` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `pointsCost` INTEGER NOT NULL DEFAULT 0,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activityId` VARCHAR(191) NULL,

    INDEX `Lottery_activityId_idx`(`activityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LotteryEntry` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lotteryId` VARCHAR(191) NOT NULL,
    `prizeId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `LotteryEntry_lotteryId_createdAt_idx`(`lotteryId`, `createdAt`),
    INDEX `LotteryEntry_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LotteryPrize` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('BADGE', 'PHYSICAL', 'COUPON', 'POINTS') NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `remaining` INTEGER NOT NULL DEFAULT 1,
    `pointsValue` INTEGER NULL,
    `metadata` JSON NULL,
    `lotteryId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LyricCard` (
    `id` VARCHAR(191) NOT NULL,
    `lyric` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `isFavorite` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `songId` VARCHAR(191) NULL,
    `templateId` VARCHAR(191) NULL,

    INDEX `LyricCard_songId_idx`(`songId`),
    INDEX `LyricCard_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LyricCardTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `backgroundUrl` VARCHAR(191) NULL,
    `textColor` VARCHAR(191) NOT NULL DEFAULT '#071722',
    `accentColor` VARCHAR(191) NOT NULL DEFAULT '#1985c2',
    `isVisible` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LyricCardTemplate_isVisible_sortOrder_idx`(`isVisible`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LyricPrescription` (
    `id` VARCHAR(191) NOT NULL,
    `text` VARCHAR(191) NOT NULL,
    `songTitle` VARCHAR(191) NOT NULL,
    `albumTitle` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `displayCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LyricPrescription_displayCount_idx`(`displayCount`),
    INDEX `LyricPrescription_enabled_createdAt_idx`(`enabled`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicAlbum` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `artist` VARCHAR(191) NOT NULL DEFAULT '陈奕迅',
    `releaseYear` INTEGER NOT NULL,
    `coverUrl` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT '粤语',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `era` VARCHAR(191) NULL,
    `albumType` VARCHAR(191) NULL,
    `releaseDate` DATETIME(3) NULL,
    `company` VARCHAR(191) NULL,
    `story` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `isFeatured` BOOLEAN NOT NULL DEFAULT false,
    `featuredOrder` INTEGER NULL,

    INDEX `MusicAlbum_releaseYear_createdAt_idx`(`releaseYear`, `createdAt`),
    INDEX `MusicAlbum_status_displayOrder_releaseYear_idx`(`status`, `displayOrder`, `releaseYear`),
    INDEX `MusicAlbum_status_isFeatured_featuredOrder_createdAt_idx`(`status`, `isFeatured`, `featuredOrder`, `createdAt`),
    UNIQUE INDEX `MusicAlbum_name_artist_releaseYear_key`(`name`, `artist`, `releaseYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicAlbumLike` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `albumId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MusicAlbumLike_albumId_idx`(`albumId`),
    INDEX `MusicAlbumLike_userId_idx`(`userId`),
    UNIQUE INDEX `MusicAlbumLike_userId_albumId_key`(`userId`, `albumId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlbumReview` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `coverUrl` TEXT NULL,
    `content` LONGTEXT NOT NULL,
    `images` JSON NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `favoriteCount` INTEGER NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `albumId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,

    INDEX `AlbumReview_albumId_status_publishedAt_idx`(`albumId`, `status`, `publishedAt`),
    INDEX `AlbumReview_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `AlbumReview_status_publishedAt_createdAt_idx`(`status`, `publishedAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlbumReviewLike` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `AlbumReviewLike_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `AlbumReviewLike_reviewId_userId_key`(`reviewId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlbumReviewFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `AlbumReviewFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `AlbumReviewFavorite_reviewId_userId_key`(`reviewId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `trackId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `MusicFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `MusicFavorite_trackId_userId_key`(`trackId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicPlayRecord` (
    `id` VARCHAR(191) NOT NULL,
    `durationSeconds` INTEGER NOT NULL DEFAULT 0,
    `playedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `trackId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `MusicPlayRecord_trackId_playedAt_idx`(`trackId`, `playedAt`),
    INDEX `MusicPlayRecord_userId_playedAt_idx`(`userId`, `playedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicSong` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `artist` VARCHAR(191) NOT NULL DEFAULT '陈奕迅',
    `albumId` VARCHAR(191) NOT NULL,
    `trackNumber` INTEGER NOT NULL,
    `releaseYear` INTEGER NOT NULL,
    `duration` INTEGER NULL,
    `coverUrl` VARCHAR(191) NULL,
    `composer` VARCHAR(191) NULL,
    `lyricist` VARCHAR(191) NULL,
    `arranger` VARCHAR(191) NULL,
    `producer` VARCHAR(191) NULL,
    `story` VARCHAR(191) NULL,
    `lyrics` VARCHAR(191) NULL,
    `sourceType` VARCHAR(191) NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `sourceAudioPath` VARCHAR(191) NULL,
    `sourceAudioDurationMs` INTEGER NULL,
    `sourceAudioRevision` VARCHAR(191) NULL,
    `previewUrl` TEXT NULL,
    `previewDuration` INTEGER NOT NULL DEFAULT 7,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `language` VARCHAR(191) NULL,
    `tags` VARCHAR(191) NULL,
    `era` VARCHAR(191) NULL,
    `trackType` VARCHAR(191) NULL,
    `concertVersion` VARCHAR(191) NULL,
    `mood` VARCHAR(191) NULL,
    `scene` VARCHAR(191) NULL,
    `recommendLevel` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `expertEnabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `MusicSong_albumId_trackNumber_idx`(`albumId`, `trackNumber`),
    INDEX `MusicSong_title_artist_idx`(`title`, `artist`),
    UNIQUE INDEX `MusicSong_albumId_title_key`(`albumId`, `title`),
    UNIQUE INDEX `MusicSong_albumId_trackNumber_key`(`albumId`, `trackNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicSongLike` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `songId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MusicSongLike_songId_idx`(`songId`),
    INDEX `MusicSongLike_userId_idx`(`userId`),
    UNIQUE INDEX `MusicSongLike_userId_songId_key`(`userId`, `songId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Rating` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `targetType` ENUM('SONG', 'ALBUM') NOT NULL,
    `songId` VARCHAR(191) NULL,
    `albumId` VARCHAR(191) NULL,
    `score` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Rating_targetType_songId_createdAt_idx`(`targetType`, `songId`, `createdAt`),
    INDEX `Rating_targetType_albumId_createdAt_idx`(`targetType`, `albumId`, `createdAt`),
    INDEX `Rating_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `Rating_userId_songId_key`(`userId`, `songId`),
    UNIQUE INDEX `Rating_userId_albumId_key`(`userId`, `albumId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RatingReview` (
    `id` VARCHAR(191) NOT NULL,
    `ratingId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `activeKey` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RatingReview_activeKey_key`(`activeKey`),
    INDEX `RatingReview_ratingId_deletedAt_createdAt_idx`(`ratingId`, `deletedAt`, `createdAt`),
    INDEX `RatingReview_userId_deletedAt_createdAt_idx`(`userId`, `deletedAt`, `createdAt`),
    INDEX `RatingReview_deletedAt_likeCount_createdAt_idx`(`deletedAt`, `likeCount`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RatingReviewLike` (
    `id` VARCHAR(191) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RatingReviewLike_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `RatingReviewLike_reviewId_userId_key`(`reviewId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RatingStats` (
    `id` VARCHAR(191) NOT NULL,
    `targetType` ENUM('SONG', 'ALBUM') NOT NULL,
    `songId` VARCHAR(191) NULL,
    `albumId` VARCHAR(191) NULL,
    `ratingCount` INTEGER NOT NULL DEFAULT 0,
    `ratingScoreTotal` INTEGER NOT NULL DEFAULT 0,
    `averageScore` DOUBLE NOT NULL DEFAULT 0,
    `reviewCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RatingStats_songId_key`(`songId`),
    UNIQUE INDEX `RatingStats_albumId_key`(`albumId`),
    INDEX `RatingStats_targetType_averageScore_ratingCount_idx`(`targetType`, `averageScore`, `ratingCount`),
    INDEX `RatingStats_targetType_updatedAt_idx`(`targetType`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PersonalRanking` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('SONG', 'ALBUM') NOT NULL,
    `visibility` ENUM('PRIVATE', 'PUBLIC') NOT NULL DEFAULT 'PRIVATE',
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PersonalRanking_userId_idx`(`userId`),
    UNIQUE INDEX `PersonalRanking_userId_type_key`(`userId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PersonalRankingItem` (
    `id` VARCHAR(191) NOT NULL,
    `rankingId` VARCHAR(191) NOT NULL,
    `songId` VARCHAR(191) NULL,
    `albumId` VARCHAR(191) NULL,
    `position` INTEGER NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PersonalRankingItem_rankingId_position_idx`(`rankingId`, `position`),
    INDEX `PersonalRankingItem_songId_idx`(`songId`),
    INDEX `PersonalRankingItem_albumId_idx`(`albumId`),
    UNIQUE INDEX `PersonalRankingItem_rankingId_songId_key`(`rankingId`, `songId`),
    UNIQUE INDEX `PersonalRankingItem_rankingId_albumId_key`(`rankingId`, `albumId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicTour` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `posterUrl` TEXT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `category` ENUM('MAIN', 'SMALL', 'GUEST') NOT NULL DEFAULT 'MAIN',
    `categoryId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MusicTour_status_idx`(`status`),
    INDEX `MusicTour_sortOrder_idx`(`sortOrder`),
    INDEX `MusicTour_startDate_idx`(`startDate`),
    INDEX `MusicTour_categoryId_idx`(`categoryId`),
    INDEX `MusicTour_status_sortOrder_startDate_createdAt_idx`(`status`, `sortOrder`, `startDate`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicConcert` (
    `id` VARCHAR(191) NOT NULL,
    `tourId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `concertDate` DATETIME(3) NOT NULL,
    `startTime` DATETIME(3) NULL,
    `endTime` DATETIME(3) NULL,
    `city` VARCHAR(191) NOT NULL,
    `countryOrRegion` VARCHAR(191) NULL,
    `stageType` ENUM('NORMAL', 'ENCORE', 'FINAL') NOT NULL DEFAULT 'NORMAL',
    `venue` VARCHAR(191) NULL,
    `sessionNumber` VARCHAR(191) NULL,
    `posterUrl` TEXT NULL,
    `description` TEXT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `contributorUserId` VARCHAR(191) NULL,
    `contributionId` VARCHAR(191) NULL,
    `setlistContributorUserId` VARCHAR(191) NULL,
    `setlistContributionId` VARCHAR(191) NULL,
    `encoreContributorUserId` VARCHAR(191) NULL,
    `encoreContributionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MusicConcert_tourId_idx`(`tourId`),
    INDEX `MusicConcert_concertDate_idx`(`concertDate`),
    INDEX `MusicConcert_city_idx`(`city`),
    INDEX `MusicConcert_status_idx`(`status`),
    INDEX `MusicConcert_tourId_concertDate_idx`(`tourId`, `concertDate`),
    INDEX `MusicConcert_tourId_city_concertDate_idx`(`tourId`, `city`, `concertDate`),
    INDEX `MusicConcert_status_concertDate_createdAt_idx`(`status`, `concertDate`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConcertContribution` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('SHOW', 'SETLIST', 'ENCORE') NOT NULL,
    `submitterId` VARCHAR(191) NOT NULL,
    `targetShowId` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `reviewerId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ConcertContribution_submitterId_status_createdAt_idx`(`submitterId`, `status`, `createdAt`),
    INDEX `ConcertContribution_status_type_createdAt_idx`(`status`, `type`, `createdAt`),
    INDEX `ConcertContribution_targetShowId_type_status_idx`(`targetShowId`, `type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserMusicConcert` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `concertId` VARCHAR(191) NOT NULL,
    `seatInfo` VARCHAR(191) NULL,
    `mood` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserMusicConcert_userId_idx`(`userId`),
    INDEX `UserMusicConcert_concertId_idx`(`concertId`),
    INDEX `UserMusicConcert_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `UserMusicConcert_concertId_isPublic_idx`(`concertId`, `isPublic`),
    UNIQUE INDEX `UserMusicConcert_userId_concertId_key`(`userId`, `concertId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MyLivePhoto` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `attendanceId` VARCHAR(191) NOT NULL,
    `category` ENUM('TICKET', 'LIVE') NOT NULL,
    `imageUrl` TEXT NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `watermarked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MyLivePhoto_attendanceId_category_sortOrder_createdAt_id_idx`(`attendanceId`, `category`, `sortOrder`, `createdAt`, `id`),
    INDEX `MyLivePhoto_userId_attendanceId_idx`(`userId`, `attendanceId`),
    INDEX `MyLivePhoto_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicConcertSetlistItem` (
    `id` VARCHAR(191) NOT NULL,
    `concertId` VARCHAR(191) NOT NULL,
    `songId` VARCHAR(191) NULL,
    `displayName` VARCHAR(191) NULL,
    `section` ENUM('OPENING', 'MAIN', 'TALK', 'REQUEST', 'ENCORE', 'SPECIAL', 'OTHER') NOT NULL DEFAULT 'MAIN',
    `position` INTEGER NOT NULL,
    `versionName` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `isEncore` BOOLEAN NOT NULL DEFAULT false,
    `isRequest` BOOLEAN NOT NULL DEFAULT false,
    `isDebut` BOOLEAN NOT NULL DEFAULT false,
    `isGuest` BOOLEAN NOT NULL DEFAULT false,
    `isMedley` BOOLEAN NOT NULL DEFAULT false,
    `isSpecial` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MusicConcertSetlistItem_concertId_idx`(`concertId`),
    INDEX `MusicConcertSetlistItem_songId_idx`(`songId`),
    INDEX `MusicConcertSetlistItem_concertId_section_position_idx`(`concertId`, `section`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicConcertHighlight` (
    `id` VARCHAR(191) NOT NULL,
    `concertId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `type` ENUM('TALK', 'GUEST', 'SONG', 'STAGE', 'INTERACTION', 'MEMORIAL', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MusicConcertHighlight_concertId_idx`(`concertId`),
    INDEX `MusicConcertHighlight_concertId_sortOrder_idx`(`concertId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicConcertCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MusicConcertCategory_slug_key`(`slug`),
    INDEX `MusicConcertCategory_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicTrack` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `artist` VARCHAR(191) NOT NULL DEFAULT 'Eason Chan',
    `source` VARCHAR(191) NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `isPlayable` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isVisible` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MusicTrack_isVisible_sortOrder_idx`(`isVisible`, `sortOrder`),
    INDEX `MusicTrack_visible_sort_createdAt_idx`(`isVisible`, `sortOrder`, `createdAt`),
    UNIQUE INDEX `MusicTrack_title_artist_key`(`title`, `artist`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('REPLY', 'LIKE', 'SYSTEM', 'MESSAGE', 'ACTIVITY', 'ADMIN', 'FOLLOW', 'BADGE', 'FRIEND_REQUEST', 'BIRTHDAY_GREETING', 'FEEDBACK', 'REVIEW') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NULL,
    `link` VARCHAR(191) NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `key` VARCHAR(191) NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `Notification_recipientId_isRead_createdAt_idx`(`recipientId`, `isRead`, `createdAt`),
    INDEX `Notification_recipientId_readAt_createdAt_idx`(`recipientId`, `readAt`, `createdAt`),
    INDEX `Notification_type_idx`(`type`),
    UNIQUE INDEX `Notification_recipientId_key_key`(`recipientId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OnlineSession` (
    `id` VARCHAR(191) NOT NULL,
    `tokenId` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,

    INDEX `OnlineSession_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PageLayout` (
    `id` VARCHAR(191) NOT NULL,
    `pageKey` VARCHAR(191) NOT NULL,
    `draftConfig` JSON NOT NULL,
    `publishedConfig` JSON NOT NULL,
    `previousPublishedConfig` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `publishedById` VARCHAR(191) NULL,

    UNIQUE INDEX `PageLayout_pageKey_key`(`pageKey`),
    INDEX `PageLayout_pageKey_idx`(`pageKey`),
    INDEX `PageLayout_publishedById_idx`(`publishedById`),
    INDEX `PageLayout_updatedById_idx`(`updatedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PageLayoutRevision` (
    `id` VARCHAR(191) NOT NULL,
    `pageLayoutId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `config` JSON NOT NULL,
    `note` VARCHAR(191) NULL,
    `source` ENUM('MANUAL', 'ROLLBACK', 'DEFAULT') NOT NULL DEFAULT 'MANUAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedById` VARCHAR(191) NULL,

    INDEX `PageLayoutRevision_pageLayoutId_createdAt_idx`(`pageLayoutId`, `createdAt`),
    INDEX `PageLayoutRevision_publishedById_idx`(`publishedById`),
    INDEX `PageLayoutRevision_source_idx`(`source`),
    UNIQUE INDEX `PageLayoutRevision_pageLayoutId_version_key`(`pageLayoutId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('SECURITY_QUESTION', 'EMAIL', 'EMAIL_LINK') NOT NULL DEFAULT 'EMAIL',
    `stage` ENUM('CHALLENGE', 'RESET_CODE', 'RESET_TOKEN') NOT NULL DEFAULT 'RESET_TOKEN',
    `codeHash` VARCHAR(191) NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `PasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `PasswordResetToken_codeHash_idx`(`codeHash`),
    INDEX `PasswordResetToken_expiresAt_idx`(`expiresAt`),
    INDEX `PasswordResetToken_userId_type_stage_createdAt_idx`(`userId`, `type`, `stage`, `createdAt`),
    INDEX `PasswordResetToken_type_stage_expiresAt_idx`(`type`, `stage`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PointLog` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('POST_CREATE', 'REPLY_CREATE', 'DAILY_CHECK_IN', 'POST_LIKE_RECEIVED', 'ADMIN_ADJUST', 'REGISTER', 'LOGIN', 'CONTINUOUS_CHECK_IN_BONUS', 'FEATURED_POST', 'ACTIVITY_REWARD', 'BADGE_EXCHANGE', 'ENTERTAINMENT_DAILY_DRAW', 'POST_DAILY_FIRST', 'POST_COMMENT_DAILY', 'POST_COMMENT_RECEIVED', 'COMMENT_POST', 'COMMENT_REVOKE', 'GUESS_SONG_DUEL_WIN', 'USER_REWARD', 'CHECK_IN_MAKEUP', 'MATERIAL_REDEMPTION', 'MATERIAL_REDEMPTION_REFUND', 'ACTIVITY_REGISTRATION_FEE', 'ACTIVITY_REGISTRATION_REFUND') NOT NULL,
    `points` INTEGER NOT NULL,
    `before` INTEGER NOT NULL,
    `after` INTEGER NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NULL,
    `replyId` VARCHAR(191) NULL,
    `checkInId` VARCHAR(191) NULL,
    `activityId` VARCHAR(191) NULL,
    `activityRegistrationId` VARCHAR(191) NULL,
    `badgeId` VARCHAR(191) NULL,
    `dailyDrawId` VARCHAR(191) NULL,
    `dateKey` VARCHAR(191) NULL,
    `businessKey` VARCHAR(191) NULL,

    UNIQUE INDEX `PointLog_dailyDrawId_key`(`dailyDrawId`),
    UNIQUE INDEX `PointLog_businessKey_key`(`businessKey`),
    INDEX `PointLog_action_idx`(`action`),
    INDEX `PointLog_activityId_idx`(`activityId`),
    INDEX `PointLog_activityRegistrationId_idx`(`activityRegistrationId`),
    INDEX `PointLog_checkInId_idx`(`checkInId`),
    INDEX `PointLog_postId_idx`(`postId`),
    INDEX `PointLog_replyId_idx`(`replyId`),
    INDEX `PointLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `PointLog_userId_action_dateKey_idx`(`userId`, `action`, `dateKey`),
    UNIQUE INDEX `PointLog_action_checkInId_key`(`action`, `checkInId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Poll` (
    `id` VARCHAR(191) NOT NULL,
    `question` VARCHAR(191) NOT NULL,
    `allowMulti` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `postId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Poll_postId_key`(`postId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PollOption` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `voteCount` INTEGER NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `pollId` VARCHAR(191) NOT NULL,

    INDEX `PollOption_pollId_sortOrder_idx`(`pollId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PollVote` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `pollId` VARCHAR(191) NOT NULL,
    `optionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `PollVote_pollId_userId_idx`(`pollId`, `userId`),
    UNIQUE INDEX `PollVote_optionId_userId_key`(`optionId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Post` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `richContent` JSON NULL,
    `ipRegion` VARCHAR(191) NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `replyCount` INTEGER NOT NULL DEFAULT 0,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `profilePinnedAt` DATETIME(3) NULL,
    `isFeatured` BOOLEAN NOT NULL DEFAULT false,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `boardId` VARCHAR(191) NOT NULL,
    `contentType` ENUM('NORMAL', 'IMAGE', 'VIDEO', 'POLL', 'ARTICLE') NOT NULL DEFAULT 'NORMAL',
    `favoriteCount` INTEGER NOT NULL DEFAULT 0,
    `isLocked` BOOLEAN NOT NULL DEFAULT false,
    `isRecommended` BOOLEAN NOT NULL DEFAULT false,
    `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readUserCount` INTEGER NOT NULL DEFAULT 0,
    `shareCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'PUBLISHED', 'LOCKED', 'DELETED') NOT NULL DEFAULT 'PUBLISHED',
    `moderationStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VIOLATION') NOT NULL DEFAULT 'APPROVED',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `rejectionReason` TEXT NULL,
    `summary` VARCHAR(191) NULL,
    `stickerId` VARCHAR(191) NULL,

    INDEX `Post_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `Post_authorId_profilePinnedAt_createdAt_idx`(`authorId`, `profilePinnedAt`, `createdAt`),
    INDEX `Post_boardId_createdAt_idx`(`boardId`, `createdAt`),
    INDEX `Post_board_feed_idx`(`boardId`, `status`, `isDeleted`, `isPinned`, `isFeatured`, `createdAt`),
    INDEX `Post_contentType_idx`(`contentType`),
    INDEX `Post_global_feed_idx`(`status`, `isDeleted`, `isPinned`, `isFeatured`, `createdAt`),
    INDEX `Post_hot_feed_idx`(`status`, `isDeleted`, `isPinned`, `isFeatured`, `likeCount`, `replyCount`),
    INDEX `Post_trending_window_idx`(`status`, `isDeleted`, `createdAt`),
    INDEX `Post_isDeleted_idx`(`isDeleted`),
    INDEX `Post_isFeatured_createdAt_idx`(`isFeatured`, `createdAt`),
    INDEX `Post_isPinned_createdAt_idx`(`isPinned`, `createdAt`),
    INDEX `Post_stickerId_idx`(`stickerId`),
    INDEX `Post_isRecommended_createdAt_idx`(`isRecommended`, `createdAt`),
    INDEX `Post_likeCount_idx`(`likeCount`),
    INDEX `Post_replyCount_idx`(`replyCount`),
    INDEX `Post_status_idx`(`status`),
    INDEX `Post_moderationStatus_createdAt_idx`(`moderationStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClinicRecord` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `category` ENUM('WORK_INJURY', 'HEARTBREAK', 'LIFE_IS_NOT_WORTH_IT', 'EASON_AFTEREFFECT', 'JUSTICE', 'LOW_PRESSURE', 'GOOD_TODAY', 'ASK_DOCTORS', 'TREE_HOLE') NOT NULL,
    `needType` ENUM('JUST_LISTEN', 'WAKE_ME_UP', 'GIVE_ADVICE', 'FIND_SOMEONE_SAME', 'ROAST_WITH_ME', 'CASUAL_CHAT') NOT NULL,
    `identityMode` ENUM('PUBLIC', 'ANONYMOUS') NOT NULL DEFAULT 'PUBLIC',
    `anonymousNumber` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'HIDDEN', 'DELETED', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
    `aspirinCount` INTEGER NOT NULL DEFAULT 0,
    `consultationCount` INTEGER NOT NULL DEFAULT 0,
    `mouthpieceCount` INTEGER NOT NULL DEFAULT 0,
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `ClinicRecord_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ClinicRecord_category_status_createdAt_idx`(`category`, `status`, `createdAt`),
    INDEX `ClinicRecord_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `ClinicRecord_consultationCount_idx`(`consultationCount`),
    INDEX `ClinicRecord_aspirinCount_idx`(`aspirinCount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClinicConsultation` (
    `id` VARCHAR(191) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `identityMode` ENUM('PUBLIC', 'ANONYMOUS') NOT NULL DEFAULT 'PUBLIC',
    `anonymousNumber` INTEGER NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `aspirinCount` INTEGER NOT NULL DEFAULT 0,
    `mouthpieceCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('ACTIVE', 'HIDDEN', 'DELETED', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `ClinicConsultation_recordId_status_createdAt_idx`(`recordId`, `status`, `createdAt`),
    INDEX `ClinicConsultation_recordId_parentId_status_createdAt_idx`(`recordId`, `parentId`, `status`, `createdAt`),
    INDEX `ClinicConsultation_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `ClinicConsultation_mouthpieceCount_createdAt_idx`(`mouthpieceCount`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClinicAspirin` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `recordId` VARCHAR(191) NULL,
    `consultationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClinicAspirin_recordId_createdAt_idx`(`recordId`, `createdAt`),
    INDEX `ClinicAspirin_consultationId_createdAt_idx`(`consultationId`, `createdAt`),
    UNIQUE INDEX `ClinicAspirin_userId_recordId_key`(`userId`, `recordId`),
    UNIQUE INDEX `ClinicAspirin_userId_consultationId_key`(`userId`, `consultationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClinicMouthpiece` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `consultationId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClinicMouthpiece_consultationId_createdAt_idx`(`consultationId`, `createdAt`),
    INDEX `ClinicMouthpiece_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `ClinicMouthpiece_userId_consultationId_key`(`userId`, `consultationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClinicReport` (
    `id` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `recordId` VARCHAR(191) NULL,
    `consultationId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `detail` TEXT NULL,
    `status` ENUM('PENDING', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `handledById` VARCHAR(191) NULL,
    `handledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClinicReport_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ClinicReport_recordId_createdAt_idx`(`recordId`, `createdAt`),
    INDEX `ClinicReport_consultationId_createdAt_idx`(`consultationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostModerationHistory` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NULL,
    `actorName` VARCHAR(191) NULL,
    `actorUsername` VARCHAR(191) NULL,
    `actorUid` INTEGER NULL,
    `action` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VIOLATION') NOT NULL,
    `titleSnapshot` VARCHAR(191) NULL,
    `rejectionReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PostModerationHistory_postId_createdAt_idx`(`postId`, `createdAt`),
    INDEX `PostModerationHistory_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `PostModerationHistory_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `postId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `PostFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `PostFavorite_postId_userId_key`(`postId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostMedia` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('IMAGE', 'VIDEO') NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `thumbnail` VARCHAR(191) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `size` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `postId` VARCHAR(191) NOT NULL,

    INDEX `PostMedia_postId_sortOrder_idx`(`postId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostTag` (
    `postId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`postId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Profile` (
    `id` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `avatarUrl` VARCHAR(191) NULL,
    `backgroundUrl` VARCHAR(191) NULL,
    `bio` VARCHAR(191) NULL,
    `displayNameModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `bioModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `locationCountryCode` VARCHAR(191) NULL,
    `locationCountry` VARCHAR(191) NULL,
    `locationRegionCode` VARCHAR(191) NULL,
    `locationRegion` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `wallVisibility` ENUM('PUBLIC', 'FRIENDS', 'CLOSED') NOT NULL DEFAULT 'PUBLIC',

    UNIQUE INDEX `Profile_userId_key`(`userId`),
    INDEX `Profile_displayName_idx`(`displayName`),
    INDEX `Profile_wallVisibility_idx`(`wallVisibility`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfileWallLike` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `ProfileWallLike_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `ProfileWallLike_messageId_userId_key`(`messageId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfileWallMessage` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `ipRegion` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,

    INDEX `ProfileWallMessage_deletedAt_idx`(`deletedAt`),
    INDEX `ProfileWallMessage_parentId_idx`(`parentId`),
    INDEX `ProfileWallMessage_receiverId_createdAt_idx`(`receiverId`, `createdAt`),
    INDEX `ProfileWallMessage_senderId_createdAt_idx`(`senderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RateLimitLog` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RateLimitLog_expiresAt_idx`(`expiresAt`),
    INDEX `RateLimitLog_key_action_idx`(`key`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reply` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `ipRegion` VARCHAR(191) NULL,
    `stickerId` VARCHAR(191) NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `likeCount` INTEGER NOT NULL DEFAULT 0,

    INDEX `Reply_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `Reply_isDeleted_idx`(`isDeleted`),
    INDEX `Reply_postId_isDeleted_isPinned_idx`(`postId`, `isDeleted`, `isPinned`),
    INDEX `Reply_parentId_idx`(`parentId`),
    INDEX `Reply_postId_createdAt_idx`(`postId`, `createdAt`),
    INDEX `Reply_stickerId_idx`(`stickerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReplyLike` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `replyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `ReplyLike_replyId_createdAt_idx`(`replyId`, `createdAt`),
    INDEX `ReplyLike_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `ReplyLike_replyId_userId_key`(`replyId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReplyMention` (
    `id` VARCHAR(191) NOT NULL,
    `replyId` VARCHAR(191) NOT NULL,
    `mentionerId` VARCHAR(191) NOT NULL,
    `mentionedUserId` VARCHAR(191) NOT NULL,
    `startIndex` INTEGER NOT NULL,
    `endIndex` INTEGER NOT NULL,
    `displayText` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReplyMention_mentionerId_createdAt_idx`(`mentionerId`, `createdAt`),
    INDEX `ReplyMention_mentionedUserId_createdAt_idx`(`mentionedUserId`, `createdAt`),
    UNIQUE INDEX `ReplyMention_replyId_mentionedUserId_key`(`replyId`, `mentionedUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Report` (
    `id` VARCHAR(191) NOT NULL,
    `targetType` ENUM('POST', 'REPLY', 'USER', 'MESSAGE', 'DAILY_MESSAGE', 'DAILY_MESSAGE_COMMENT') NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `targetUserId` VARCHAR(191) NULL,
    `postId` VARCHAR(191) NULL,
    `replyId` VARCHAR(191) NULL,
    `dailyMessageId` VARCHAR(191) NULL,

    INDEX `Report_dailyMessageId_idx`(`dailyMessageId`),
    INDEX `Report_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Report_targetType_idx`(`targetType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchHistory` (
    `id` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,

    INDEX `SearchHistory_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchKeyword` (
    `id` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SearchKeyword_keyword_key`(`keyword`),
    INDEX `SearchKeyword_count_idx`(`count`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SensitiveWord` (
    `id` VARCHAR(191) NOT NULL,
    `word` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SensitiveWord_word_key`(`word`),
    INDEX `SensitiveWord_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BannedWord` (
    `id` VARCHAR(191) NOT NULL,
    `word` VARCHAR(191) NOT NULL,
    `normalizedWord` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` ENUM('NORMAL', 'HIGH') NOT NULL DEFAULT 'NORMAL',
    `note` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BannedWord_normalizedWord_key`(`normalizedWord`),
    INDEX `BannedWord_enabled_priority_idx`(`enabled`, `priority`),
    INDEX `BannedWord_word_idx`(`word`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentModerationScanJob` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('SCANNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'SCANNING',
    `summary` JSON NULL,
    `error` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `ContentModerationScanJob_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyJobExecution` (
    `id` VARCHAR(191) NOT NULL,
    `jobKey` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(191) NOT NULL,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `runToken` VARCHAR(64) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DailyJobExecution_status_startedAt_idx`(`status`, `startedAt`),
    UNIQUE INDEX `DailyJobExecution_jobKey_dateKey_key`(`jobKey`, `dateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SiteSetting` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `valueType` ENUM('TEXT', 'IMAGE', 'JSON', 'BOOLEAN', 'NUMBER') NOT NULL DEFAULT 'TEXT',
    `group` VARCHAR(191) NOT NULL DEFAULT 'general',
    `label` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SiteSetting_key_key`(`key`),
    INDEX `SiteSetting_group_idx`(`group`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EcenterFeatureSetting` (
    `id` VARCHAR(191) NOT NULL,
    `featureKey` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EcenterFeatureSetting_featureKey_key`(`featureKey`),
    INDEX `EcenterFeatureSetting_sortOrder_isEnabled_idx`(`sortOrder`, `isEnabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserCenterShortcutPreference` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `itemKey` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserCenterShortcutPreference_userId_sortOrder_idx`(`userId`, `sortOrder`),
    UNIQUE INDEX `UserCenterShortcutPreference_userId_itemKey_key`(`userId`, `itemKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SmsCode` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `scene` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SmsCode_expiresAt_idx`(`expiresAt`),
    INDEX `SmsCode_phone_scene_idx`(`phone`, `scene`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StickerPack` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `coverUrl` VARCHAR(191) NULL,
    `creatorId` VARCHAR(191) NOT NULL,
    `type` ENUM('STATIC', 'GIF') NOT NULL DEFAULT 'STATIC',
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `rejectionReason` TEXT NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `isOfficial` BOOLEAN NOT NULL DEFAULT false,
    `category` VARCHAR(191) NULL,

    INDEX `StickerPack_creatorId_createdAt_idx`(`creatorId`, `createdAt`),
    INDEX `StickerPack_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `StickerPack_isOfficial_status_idx`(`isOfficial`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sticker` (
    `id` VARCHAR(191) NOT NULL,
    `packId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(32) NULL,
    `moderationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `url` VARCHAR(191) NOT NULL,
    `type` ENUM('STATIC', 'GIF') NOT NULL DEFAULT 'STATIC',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `usageCount` INTEGER NOT NULL DEFAULT 0,
    `isHidden` BOOLEAN NOT NULL DEFAULT false,
    `hiddenAt` DATETIME(3) NULL,
    `hiddenReason` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Sticker_packId_sort_idx`(`packId`, `sort`),
    INDEX `Sticker_isHidden_idx`(`isHidden`),
    INDEX `Sticker_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserStickerPack` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `packId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserStickerPack_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `UserStickerPack_packId_idx`(`packId`),
    UNIQUE INDEX `UserStickerPack_userId_packId_key`(`userId`, `packId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StickerFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StickerFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `StickerFavorite_stickerId_idx`(`stickerId`),
    UNIQUE INDEX `StickerFavorite_userId_stickerId_key`(`userId`, `stickerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StickerUsage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StickerUsage_userId_lastUsedAt_idx`(`userId`, `lastUsedAt`),
    INDEX `StickerUsage_stickerId_idx`(`stickerId`),
    UNIQUE INDEX `StickerUsage_userId_stickerId_key`(`userId`, `stickerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StickerReport` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `reason` ENUM('PORN', 'ABUSE', 'VIOLATION', 'OTHER') NOT NULL,
    `status` ENUM('PENDING', 'HIDDEN', 'DISMISSED') NOT NULL DEFAULT 'PENDING',
    `detail` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `handledAt` DATETIME(3) NULL,

    INDEX `StickerReport_status_idx`(`status`),
    INDEX `StickerReport_stickerId_idx`(`stickerId`),
    INDEX `StickerReport_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemNotification` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `link` VARCHAR(191) NULL,
    `type` ENUM('SYSTEM', 'UPDATE', 'ANNOUNCEMENT', 'ACTIVITY', 'MAINTENANCE', 'SECURITY') NOT NULL DEFAULT 'SYSTEM',
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `cover` VARCHAR(191) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `popup` BOOLEAN NOT NULL DEFAULT false,
    `sticky` BOOLEAN NOT NULL DEFAULT false,
    `publishAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expireAt` DATETIME(3) NULL,
    `published` BOOLEAN NOT NULL DEFAULT true,
    `buttonText` VARCHAR(191) NULL,
    `buttonUrl` VARCHAR(191) NULL,
    `version` VARCHAR(191) NULL,

    INDEX `SystemNotification_createdById_createdAt_idx`(`createdById`, `createdAt`),
    INDEX `SystemNotification_expireAt_idx`(`expireAt`),
    INDEX `SystemNotification_isPublished_publishedAt_idx`(`isPublished`, `publishedAt`),
    INDEX `SystemNotification_priority_idx`(`priority`),
    INDEX `SystemNotification_published_publishAt_idx`(`published`, `publishAt`),
    INDEX `SystemNotification_sticky_priority_publishAt_idx`(`sticky`, `priority`, `publishAt`),
    INDEX `SystemNotification_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemNotificationRead` (
    `id` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notificationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `SystemNotificationRead_notificationId_idx`(`notificationId`),
    INDEX `SystemNotificationRead_userId_readAt_idx`(`userId`, `readAt`),
    UNIQUE INDEX `SystemNotificationRead_notificationId_userId_key`(`notificationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `usageCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tag_name_key`(`name`),
    UNIQUE INDEX `Tag_slug_key`(`slug`),
    INDEX `Tag_usageCount_idx`(`usageCount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `expReward` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Task_createdAt_idx`(`createdAt`),
    INDEX `Task_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `nickname` VARCHAR(191) NOT NULL,
    `avatarUrl` VARCHAR(191) NULL,
    `bio` VARCHAR(191) NULL,
    `usernameModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `nicknameModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `bioModerationStatus` ENUM('NORMAL', 'VIOLATION') NOT NULL DEFAULT 'NORMAL',
    `moderationReason` VARCHAR(191) NULL,
    `matchedBannedWords` TEXT NULL,
    `nicknameViolationDisplay` VARCHAR(32) NULL,
    `nicknameViolationCount` INTEGER NOT NULL DEFAULT 0,
    `role` ENUM('USER', 'ADMIN', 'MODERATOR', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER',
    `canPlayFullMusic` BOOLEAN NOT NULL DEFAULT false,
    `level` INTEGER NOT NULL DEFAULT 1,
    `points` INTEGER NOT NULL DEFAULT 0,
    `consecutiveDays` INTEGER NOT NULL DEFAULT 0,
    `lastCheckInDate` DATETIME(3) NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `backgroundUrl` VARCHAR(191) NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `exp` INTEGER NOT NULL DEFAULT 0,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `lastActiveAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `phoneVerifiedAt` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'BANNED', 'MUTED', 'DELETED', 'MERGED', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `verificationStatus` ENUM('NONE', 'PENDING', 'VERIFIED') NOT NULL DEFAULT 'NONE',
    `nicknameChangedAt` DATETIME(3) NULL,
    `birthMonth` INTEGER NULL,
    `birthDay` INTEGER NULL,
    `birthdaySetAt` DATETIME(3) NULL,
    `birthdayPublic` BOOLEAN NOT NULL DEFAULT true,
    `uid` INTEGER NOT NULL AUTO_INCREMENT,
    `experience` INTEGER NOT NULL DEFAULT 0,
    `securityQuestionRecoveryEnabled` BOOLEAN NOT NULL DEFAULT false,
    `registrationIdempotencyKeyHash` VARCHAR(191) NULL,
    `mustSetupSecurity` BOOLEAN NOT NULL DEFAULT false,
    `usernameNormalized` VARCHAR(191) NOT NULL,
    `usernameChangedAt` DATETIME(3) NULL,
    `equippedBadgeId` VARCHAR(191) NULL,
    `checkinMoodEnabled` BOOLEAN NOT NULL DEFAULT true,
    `showBadgeActivity` BOOLEAN NOT NULL DEFAULT true,
    `showBadgeProgressNotifications` BOOLEAN NOT NULL DEFAULT true,
    `ipRegion` VARCHAR(191) NULL,
    `ipRegionUpdatedAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_uid_key`(`uid`),
    UNIQUE INDEX `User_registrationIdempotencyKeyHash_key`(`registrationIdempotencyKeyHash`),
    UNIQUE INDEX `User_usernameNormalized_key`(`usernameNormalized`),
    INDEX `User_createdAt_idx`(`createdAt`),
    INDEX `User_email_idx`(`email`),
    INDEX `User_experience_idx`(`experience`),
    INDEX `User_isDeleted_idx`(`isDeleted`),
    INDEX `User_lastActiveAt_idx`(`lastActiveAt`),
    INDEX `User_level_idx`(`level`),
    INDEX `User_phone_idx`(`phone`),
    INDEX `User_points_idx`(`points`),
    INDEX `User_role_idx`(`role`),
    INDEX `User_status_idx`(`status`),
    INDEX `User_uid_idx`(`uid`),
    INDEX `User_username_idx`(`username`),
    INDEX `User_birthMonth_birthDay_idx`(`birthMonth`, `birthDay`),
    INDEX `User_nicknameViolationDisplay_idx`(`nicknameViolationDisplay`),
    INDEX `User_equippedBadgeId_idx`(`equippedBadgeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserPrivacySetting` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `showCheckInHistory` BOOLEAN NOT NULL DEFAULT true,
    `showCheckInMessages` BOOLEAN NOT NULL DEFAULT true,
    `showPosts` BOOLEAN NOT NULL DEFAULT true,
    `showComments` BOOLEAN NOT NULL DEFAULT true,
    `showConcertHistory` BOOLEAN NOT NULL DEFAULT true,
    `showActivityHistory` BOOLEAN NOT NULL DEFAULT true,
    `showBadgeHistory` BOOLEAN NOT NULL DEFAULT true,
    `showRatings` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserPrivacySetting_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserAchievement` (
    `id` VARCHAR(191) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `unlocked` BOOLEAN NOT NULL DEFAULT false,
    `unlockedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `achievementId` VARCHAR(191) NOT NULL,

    INDEX `UserAchievement_achievementId_idx`(`achievementId`),
    INDEX `UserAchievement_userId_unlocked_idx`(`userId`, `unlocked`),
    UNIQUE INDEX `UserAchievement_userId_achievementId_key`(`userId`, `achievementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserAlbumCollection` (
    `id` VARCHAR(191) NOT NULL,
    `owned` BOOLEAN NOT NULL DEFAULT true,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `albumId` VARCHAR(191) NOT NULL,

    INDEX `UserAlbumCollection_userId_owned_idx`(`userId`, `owned`),
    UNIQUE INDEX `UserAlbumCollection_userId_albumId_key`(`userId`, `albumId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserBadge` (
    `id` VARCHAR(191) NOT NULL,
    `isHidden` BOOLEAN NOT NULL DEFAULT false,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `obtainedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sourceType` VARCHAR(32) NULL,
    `sourceId` VARCHAR(191) NULL,
    `grantReason` VARCHAR(500) NULL,
    `grantedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,

    INDEX `UserBadge_userId_displayOrder_idx`(`userId`, `displayOrder`),
    INDEX `UserBadge_userId_obtainedAt_idx`(`userId`, `obtainedAt`),
    INDEX `UserBadge_badgeId_idx`(`badgeId`),
    INDEX `UserBadge_grantedBy_createdAt_idx`(`grantedBy`, `createdAt`),
    UNIQUE INDEX `UserBadge_userId_badgeId_key`(`userId`, `badgeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserBadgeShowcase` (
    `id` VARCHAR(191) NOT NULL,
    `slot` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,

    INDEX `UserBadgeShowcase_badgeId_idx`(`badgeId`),
    UNIQUE INDEX `UserBadgeShowcase_userId_badgeId_key`(`userId`, `badgeId`),
    UNIQUE INDEX `UserBadgeShowcase_userId_slot_key`(`userId`, `slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserBadgeTracking` (
    `id` VARCHAR(191) NOT NULL,
    `lastMilestone` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,

    INDEX `UserBadgeTracking_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `UserBadgeTracking_badgeId_idx`(`badgeId`),
    UNIQUE INDEX `UserBadgeTracking_userId_badgeId_key`(`userId`, `badgeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSecurityQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `question` VARCHAR(191) NOT NULL,
    `answerHash` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `UserSecurityQuestion_userId_key`(`userId`),
    INDEX `UserSecurityQuestion_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSecurityQuestion_backup_20260718` (
    `id` VARCHAR(191) NULL,
    `question` VARCHAR(191) NULL,
    `answerHash` VARCHAR(191) NULL,
    `sortOrder` INTEGER NULL,
    `createdAt` DATETIME(3) NULL,
    `userId` VARCHAR(191) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NicknameViolationLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `originalNickname` VARCHAR(32) NULL,
    `reason` VARCHAR(191) NULL,
    `violationGeneratedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `generatedDisplayName` VARCHAR(32) NOT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedNickname` VARCHAR(32) NULL,
    `violationCount` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NicknameViolationLog_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaderboardAdminLog` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetUserId` VARCHAR(191) NULL,
    `gameType` VARCHAR(191) NULL,
    `deletedCount` INTEGER NOT NULL DEFAULT 0,
    `reason` VARCHAR(191) NULL,
    `adminUid` INTEGER NULL,
    `adminNickname` VARCHAR(64) NULL,
    `adminUsername` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeaderboardAdminLog_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `LeaderboardAdminLog_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialPost` (
    `id` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM') NOT NULL DEFAULT 'INSTAGRAM',
    `externalId` VARCHAR(191) NOT NULL,
    `shortcode` VARCHAR(191) NULL,
    `authorUsername` VARCHAR(191) NOT NULL,
    `authorDisplayName` VARCHAR(191) NULL,
    `caption` TEXT NULL,
    `permalink` TEXT NULL,
    `publishedAt` DATETIME(3) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `mediaType` ENUM('IMAGE', 'VIDEO', 'CAROUSEL', 'REEL') NOT NULL,
    `status` ENUM('DISCOVERED', 'DOWNLOADING', 'READY', 'FAILED', 'HIDDEN', 'SOURCE_DELETED') NOT NULL DEFAULT 'DISCOVERED',
    `provider` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SocialPost_status_publishedAt_idx`(`status`, `publishedAt`),
    INDEX `SocialPost_authorUsername_publishedAt_idx`(`authorUsername`, `publishedAt`),
    UNIQUE INDEX `SocialPost_platform_externalId_key`(`platform`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialPostMedia` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `type` ENUM('IMAGE', 'VIDEO') NOT NULL,
    `storageUrl` TEXT NOT NULL,
    `thumbnailUrl` TEXT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SocialPostMedia_postId_sortOrder_idx`(`postId`, `sortOrder`),
    UNIQUE INDEX `SocialPostMedia_postId_sortOrder_key`(`postId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialPostLike` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SocialPostLike_postId_createdAt_idx`(`postId`, `createdAt`),
    UNIQUE INDEX `SocialPostLike_userId_postId_key`(`userId`, `postId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialPostComment` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `SocialPostComment_postId_parentId_createdAt_idx`(`postId`, `parentId`, `createdAt`),
    INDEX `SocialPostComment_authorId_createdAt_idx`(`authorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialSyncLog` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `actor` VARCHAR(191) NULL,
    `runId` VARCHAR(191) NULL,
    `datasetId` VARCHAR(191) NULL,
    `runStatus` VARCHAR(64) NULL,
    `runStartedAt` DATETIME(3) NULL,
    `runFinishedAt` DATETIME(3) NULL,
    `usageTotalUsd` DOUBLE NULL,
    `billableResults` INTEGER NULL,
    `target` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'RATE_LIMITED', 'CHALLENGE_REQUIRED') NOT NULL DEFAULT 'RUNNING',
    `foundCount` INTEGER NOT NULL DEFAULT 0,
    `createdCount` INTEGER NOT NULL DEFAULT 0,
    `updatedCount` INTEGER NOT NULL DEFAULT 0,
    `mediaCount` INTEGER NOT NULL DEFAULT 0,
    `notificationCount` INTEGER NOT NULL DEFAULT 0,
    `baselineImport` BOOLEAN NOT NULL DEFAULT false,
    `durationMs` INTEGER NULL,
    `errorCode` VARCHAR(64) NULL,
    `errorMessage` TEXT NULL,

    INDEX `SocialSyncLog_target_startedAt_idx`(`target`, `startedAt`),
    INDEX `SocialSyncLog_status_startedAt_idx`(`status`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialSyncState` (
    `id` VARCHAR(191) NOT NULL,
    `platform` ENUM('INSTAGRAM') NOT NULL DEFAULT 'INSTAGRAM',
    `target` VARCHAR(191) NOT NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastSuccessfulSyncAt` DATETIME(3) NULL,
    `lastChangedAt` DATETIME(3) NULL,
    `lastExternalId` VARCHAR(191) NULL,
    `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    `nextAllowedSyncAt` DATETIME(3) NULL,
    `lastErrorCode` VARCHAR(64) NULL,
    `lastErrorAt` DATETIME(3) NULL,
    `baselineCompletedAt` DATETIME(3) NULL,
    `syncRequestedAt` DATETIME(3) NULL,
    `lockToken` VARCHAR(64) NULL,
    `lockUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SocialSyncState_nextAllowedSyncAt_idx`(`nextAllowedSyncAt`),
    INDEX `SocialSyncState_lastSuccessfulSyncAt_idx`(`lastSuccessfulSyncAt`),
    UNIQUE INDEX `SocialSyncState_platform_target_key`(`platform`, `target`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccountSecurityLog` ADD CONSTRAINT `AccountSecurityLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Activity` ADD CONSTRAINT `Activity_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Activity` ADD CONSTRAINT `Activity_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityFavorite` ADD CONSTRAINT `ActivityFavorite_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityFavorite` ADD CONSTRAINT `ActivityFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRegistration` ADD CONSTRAINT `ActivityRegistration_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRegistration` ADD CONSTRAINT `ActivityRegistration_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRegistration` ADD CONSTRAINT `ActivityRegistration_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRegistration` ADD CONSTRAINT `ActivityRegistration_linkedMaterialRedemptionId_fkey` FOREIGN KEY (`linkedMaterialRedemptionId`) REFERENCES `MaterialRedemptionOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRegistrationQuestion` ADD CONSTRAINT `ActivityRegistrationQuestion_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRegistrationQuestionOption` ADD CONSTRAINT `ActivityRegistrationQuestionOption_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `ActivityRegistrationQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRegistrationAnswer` ADD CONSTRAINT `ActivityRegistrationAnswer_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `ActivityRegistration`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRegistrationAnswer` ADD CONSTRAINT `ActivityRegistrationAnswer_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `ActivityRegistrationQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityReward` ADD CONSTRAINT `ActivityReward_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityReward` ADD CONSTRAINT `ActivityReward_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAction` ADD CONSTRAINT `AdminAction_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAction` ADD CONSTRAINT `AdminAction_boardId_fkey` FOREIGN KEY (`boardId`) REFERENCES `Board`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAction` ADD CONSTRAINT `AdminAction_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAction` ADD CONSTRAINT `AdminAction_replyId_fkey` FOREIGN KEY (`replyId`) REFERENCES `Reply`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAction` ADD CONSTRAINT `AdminAction_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminActionLog` ADD CONSTRAINT `AdminActionLog_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminActionLog` ADD CONSTRAINT `AdminActionLog_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminPermission` ADD CONSTRAINT `AdminPermission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemption` ADD CONSTRAINT `MaterialRedemption_createdByAdminId_fkey` FOREIGN KEY (`createdByAdminId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemption` ADD CONSTRAINT `MaterialRedemption_linkedActivityId_fkey` FOREIGN KEY (`linkedActivityId`) REFERENCES `Activity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemptionRule` ADD CONSTRAINT `MaterialRedemptionRule_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `MaterialRedemption`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemptionOrder` ADD CONSTRAINT `MaterialRedemptionOrder_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `MaterialRedemption`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemptionOrder` ADD CONSTRAINT `MaterialRedemptionOrder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemptionOrder` ADD CONSTRAINT `MaterialRedemptionOrder_linkedActivityId_fkey` FOREIGN KEY (`linkedActivityId`) REFERENCES `Activity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemptionOrder` ADD CONSTRAINT `MaterialRedemptionOrder_redeemedByAdminId_fkey` FOREIGN KEY (`redeemedByAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemptionOrder` ADD CONSTRAINT `MaterialRedemptionOrder_cancelledByAdminId_fkey` FOREIGN KEY (`cancelledByAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialRedemptionOrder` ADD CONSTRAINT `MaterialRedemptionOrder_refundedByAdminId_fkey` FOREIGN KEY (`refundedByAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserReward` ADD CONSTRAINT `UserReward_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserReward` ADD CONSTRAINT `UserReward_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BadgeSeries` ADD CONSTRAINT `BadgeSeries_completionRewardBadgeId_fkey` FOREIGN KEY (`completionRewardBadgeId`) REFERENCES `Badge`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Badge` ADD CONSTRAINT `Badge_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `BadgeSeries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Badge` ADD CONSTRAINT `Badge_musicTourId_fkey` FOREIGN KEY (`musicTourId`) REFERENCES `MusicTour`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BadgeRule` ADD CONSTRAINT `BadgeRule_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TodayEvent` ADD CONSTRAINT `TodayEvent_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TodayEvent` ADD CONSTRAINT `TodayEvent_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDailyMusicRecommendation` ADD CONSTRAINT `UserDailyMusicRecommendation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDailyMusicRecommendation` ADD CONSTRAINT `UserDailyMusicRecommendation_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Block` ADD CONSTRAINT `Block_blockedId_fkey` FOREIGN KEY (`blockedId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Block` ADD CONSTRAINT `Block_blockerId_fkey` FOREIGN KEY (`blockerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Board` ADD CONSTRAINT `Board_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `BoardCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Board` ADD CONSTRAINT `Board_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Board`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BoardFavorite` ADD CONSTRAINT `BoardFavorite_boardId_fkey` FOREIGN KEY (`boardId`) REFERENCES `Board`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BoardFavorite` ADD CONSTRAINT `BoardFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Changelog` ADD CONSTRAINT `Changelog_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CheckIn` ADD CONSTRAINT `CheckIn_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CheckIn` ADD CONSTRAINT `CheckIn_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `MakeupChallenge`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MakeupChallenge` ADD CONSTRAINT `MakeupChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MakeupChallenge` ADD CONSTRAINT `MakeupChallenge_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `GuessSongQuestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationParticipant` ADD CONSTRAINT `ConversationParticipant_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationParticipant` ADD CONSTRAINT `ConversationParticipant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CultureComment` ADD CONSTRAINT `CultureComment_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `CultureItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CultureComment` ADD CONSTRAINT `CultureComment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CultureFavorite` ADD CONSTRAINT `CultureFavorite_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `CultureItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CultureFavorite` ADD CONSTRAINT `CultureFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyExperienceRecord` ADD CONSTRAINT `DailyExperienceRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessage` ADD CONSTRAINT `DailyMessage_checkInId_fkey` FOREIGN KEY (`checkInId`) REFERENCES `CheckIn`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessage` ADD CONSTRAINT `DailyMessage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessageComment` ADD CONSTRAINT `DailyMessageComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessageComment` ADD CONSTRAINT `DailyMessageComment_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `DailyMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessageComment` ADD CONSTRAINT `DailyMessageComment_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `DailyMessageComment`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessageFavorite` ADD CONSTRAINT `DailyMessageFavorite_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `DailyMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessageFavorite` ADD CONSTRAINT `DailyMessageFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessageLike` ADD CONSTRAINT `DailyMessageLike_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `DailyMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyMessageLike` ADD CONSTRAINT `DailyMessageLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyTaskProgress` ADD CONSTRAINT `DailyTaskProgress_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `DailyTaskTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyTaskProgress` ADD CONSTRAINT `DailyTaskProgress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DirectMessage` ADD CONSTRAINT `DirectMessage_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DirectMessage` ADD CONSTRAINT `DirectMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DirectMessage` ADD CONSTRAINT `DirectMessage_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailVerification` ADD CONSTRAINT `EmailVerification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EHospitalCheckSession` ADD CONSTRAINT `EHospitalCheckSession_registrationDraftId_fkey` FOREIGN KEY (`registrationDraftId`) REFERENCES `RegistrationDraft`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EHospitalCheckAttempt` ADD CONSTRAINT `EHospitalCheckAttempt_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `EHospitalCheckSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EHospitalCheckAttempt` ADD CONSTRAINT `EHospitalCheckAttempt_registrationDraftId_fkey` FOREIGN KEY (`registrationDraftId`) REFERENCES `RegistrationDraft`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EHospitalCheckAttempt` ADD CONSTRAINT `EHospitalCheckAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EntertainmentDailyDraw` ADD CONSTRAINT `EntertainmentDailyDraw_lyricPrescriptionId_fkey` FOREIGN KEY (`lyricPrescriptionId`) REFERENCES `LyricPrescription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EntertainmentDailyDraw` ADD CONSTRAINT `EntertainmentDailyDraw_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExperienceLog` ADD CONSTRAINT `ExperienceLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedback` ADD CONSTRAINT `Feedback_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackAttachment` ADD CONSTRAINT `FeedbackAttachment_feedbackId_fkey` FOREIGN KEY (`feedbackId`) REFERENCES `Feedback`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackAttachment` ADD CONSTRAINT `FeedbackAttachment_replyId_fkey` FOREIGN KEY (`replyId`) REFERENCES `FeedbackReply`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackReply` ADD CONSTRAINT `FeedbackReply_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackReply` ADD CONSTRAINT `FeedbackReply_feedbackId_fkey` FOREIGN KEY (`feedbackId`) REFERENCES `Feedback`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Follow` ADD CONSTRAINT `Follow_followerId_fkey` FOREIGN KEY (`followerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Follow` ADD CONSTRAINT `Follow_followingId_fkey` FOREIGN KEY (`followingId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendActivity` ADD CONSTRAINT `FriendActivity_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendActivity` ADD CONSTRAINT `FriendActivity_checkInId_fkey` FOREIGN KEY (`checkInId`) REFERENCES `CheckIn`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendActivity` ADD CONSTRAINT `FriendActivity_dailyMessageId_fkey` FOREIGN KEY (`dailyMessageId`) REFERENCES `DailyMessage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendRequest` ADD CONSTRAINT `FriendRequest_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendRequest` ADD CONSTRAINT `FriendRequest_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Friendship` ADD CONSTRAINT `Friendship_userAId_fkey` FOREIGN KEY (`userAId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Friendship` ADD CONSTRAINT `Friendship_userBId_fkey` FOREIGN KEY (`userBId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendFollow` ADD CONSTRAINT `FriendFollow_followerId_fkey` FOREIGN KEY (`followerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendFollow` ADD CONSTRAINT `FriendFollow_followedId_fkey` FOREIGN KEY (`followedId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendRemark` ADD CONSTRAINT `FriendRemark_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendRemark` ADD CONSTRAINT `FriendRemark_friendId_fkey` FOREIGN KEY (`friendId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendGroup` ADD CONSTRAINT `FriendGroup_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendGroupMember` ADD CONSTRAINT `FriendGroupMember_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendGroupMember` ADD CONSTRAINT `FriendGroupMember_friendId_fkey` FOREIGN KEY (`friendId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendGroupMember` ADD CONSTRAINT `FriendGroupMember_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `FriendGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongAudioVariant` ADD CONSTRAINT `GuessSongAudioVariant_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `GuessSongQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongLeaderboardEntry` ADD CONSTRAINT `GuessSongLeaderboardEntry_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `GuessSongSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongLeaderboardEntry` ADD CONSTRAINT `GuessSongLeaderboardEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WantListenSession` ADD CONSTRAINT `WantListenSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WantListenSessionQuestion` ADD CONSTRAINT `WantListenSessionQuestion_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `WantListenSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WantListenStats` ADD CONSTRAINT `WantListenStats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WantListenLeaderboardEntry` ADD CONSTRAINT `WantListenLeaderboardEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WantListenLeaderboardEntry` ADD CONSTRAINT `WantListenLeaderboardEntry_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `WantListenSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverRoom` ADD CONSTRAINT `UndercoverRoom_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverRoomPlayer` ADD CONSTRAINT `UndercoverRoomPlayer_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `UndercoverRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverRoomPlayer` ADD CONSTRAINT `UndercoverRoomPlayer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverMatch` ADD CONSTRAINT `UndercoverMatch_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `UndercoverRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverMatch` ADD CONSTRAINT `UndercoverMatch_wordPairId_fkey` FOREIGN KEY (`wordPairId`) REFERENCES `UndercoverWordPair`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverMatchPlayer` ADD CONSTRAINT `UndercoverMatchPlayer_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `UndercoverMatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverMatchPlayer` ADD CONSTRAINT `UndercoverMatchPlayer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverDescription` ADD CONSTRAINT `UndercoverDescription_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `UndercoverMatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverDescription` ADD CONSTRAINT `UndercoverDescription_matchPlayerId_fkey` FOREIGN KEY (`matchPlayerId`) REFERENCES `UndercoverMatchPlayer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverVote` ADD CONSTRAINT `UndercoverVote_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `UndercoverMatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverVote` ADD CONSTRAINT `UndercoverVote_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `UndercoverMatchPlayer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverVote` ADD CONSTRAINT `UndercoverVote_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `UndercoverMatchPlayer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverStats` ADD CONSTRAINT `UndercoverStats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverRoomMessage` ADD CONSTRAINT `UndercoverRoomMessage_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `UndercoverRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverRoomMessage` ADD CONSTRAINT `UndercoverRoomMessage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverMatchResult` ADD CONSTRAINT `UndercoverMatchResult_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `UndercoverMatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UndercoverMatchResult` ADD CONSTRAINT `UndercoverMatchResult_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongPlayRequest` ADD CONSTRAINT `GuessSongPlayRequest_audioVariantId_fkey` FOREIGN KEY (`audioVariantId`) REFERENCES `GuessSongAudioVariant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongPlayRequest` ADD CONSTRAINT `GuessSongPlayRequest_sessionQuestionId_fkey` FOREIGN KEY (`sessionQuestionId`) REFERENCES `GuessSongSessionQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongQuestion` ADD CONSTRAINT `GuessSongQuestion_musicSongId_fkey` FOREIGN KEY (`musicSongId`) REFERENCES `MusicSong`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongSession` ADD CONSTRAINT `GuessSongSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongSessionQuestion` ADD CONSTRAINT `GuessSongSessionQuestion_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `GuessSongQuestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongSessionQuestion` ADD CONSTRAINT `GuessSongSessionQuestion_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `GuessSongSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongRiskLog` ADD CONSTRAINT `GuessSongRiskLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongRiskLog` ADD CONSTRAINT `GuessSongRiskLog_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `GuessSongSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GameAntiCheatLog` ADD CONSTRAINT `GameAntiCheatLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelRoom` ADD CONSTRAINT `GuessSongDuelRoom_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelRoom` ADD CONSTRAINT `GuessSongDuelRoom_challengerId_fkey` FOREIGN KEY (`challengerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelMatch` ADD CONSTRAINT `GuessSongDuelMatch_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `GuessSongDuelRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelMatch` ADD CONSTRAINT `GuessSongDuelMatch_winnerId_fkey` FOREIGN KEY (`winnerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelPlayer` ADD CONSTRAINT `GuessSongDuelPlayer_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `GuessSongDuelMatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelPlayer` ADD CONSTRAINT `GuessSongDuelPlayer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelQuestion` ADD CONSTRAINT `GuessSongDuelQuestion_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `GuessSongDuelMatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelQuestion` ADD CONSTRAINT `GuessSongDuelQuestion_sourceQuestionId_fkey` FOREIGN KEY (`sourceQuestionId`) REFERENCES `GuessSongQuestion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelAnswer` ADD CONSTRAINT `GuessSongDuelAnswer_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `GuessSongDuelMatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelAnswer` ADD CONSTRAINT `GuessSongDuelAnswer_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `GuessSongDuelQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelAnswer` ADD CONSTRAINT `GuessSongDuelAnswer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelStats` ADD CONSTRAINT `GuessSongDuelStats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelInvite` ADD CONSTRAINT `GuessSongDuelInvite_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `GuessSongDuelRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelInvite` ADD CONSTRAINT `GuessSongDuelInvite_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GuessSongDuelInvite` ADD CONSTRAINT `GuessSongDuelInvite_inviteeId_fkey` FOREIGN KEY (`inviteeId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Like` ADD CONSTRAINT `Like_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Like` ADD CONSTRAINT `Like_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoginDevice` ADD CONSTRAINT `LoginDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lottery` ADD CONSTRAINT `Lottery_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotteryEntry` ADD CONSTRAINT `LotteryEntry_lotteryId_fkey` FOREIGN KEY (`lotteryId`) REFERENCES `Lottery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotteryEntry` ADD CONSTRAINT `LotteryEntry_prizeId_fkey` FOREIGN KEY (`prizeId`) REFERENCES `LotteryPrize`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotteryEntry` ADD CONSTRAINT `LotteryEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotteryPrize` ADD CONSTRAINT `LotteryPrize_lotteryId_fkey` FOREIGN KEY (`lotteryId`) REFERENCES `Lottery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LyricCard` ADD CONSTRAINT `LyricCard_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `CultureItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LyricCard` ADD CONSTRAINT `LyricCard_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `LyricCardTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LyricCard` ADD CONSTRAINT `LyricCard_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicAlbumLike` ADD CONSTRAINT `MusicAlbumLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicAlbumLike` ADD CONSTRAINT `MusicAlbumLike_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumReview` ADD CONSTRAINT `AlbumReview_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumReview` ADD CONSTRAINT `AlbumReview_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumReviewLike` ADD CONSTRAINT `AlbumReviewLike_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `AlbumReview`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumReviewLike` ADD CONSTRAINT `AlbumReviewLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumReviewFavorite` ADD CONSTRAINT `AlbumReviewFavorite_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `AlbumReview`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumReviewFavorite` ADD CONSTRAINT `AlbumReviewFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicFavorite` ADD CONSTRAINT `MusicFavorite_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `MusicTrack`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicFavorite` ADD CONSTRAINT `MusicFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicPlayRecord` ADD CONSTRAINT `MusicPlayRecord_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `MusicTrack`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicPlayRecord` ADD CONSTRAINT `MusicPlayRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicSong` ADD CONSTRAINT `MusicSong_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicSongLike` ADD CONSTRAINT `MusicSongLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicSongLike` ADD CONSTRAINT `MusicSongLike_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RatingReview` ADD CONSTRAINT `RatingReview_ratingId_fkey` FOREIGN KEY (`ratingId`) REFERENCES `Rating`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RatingReview` ADD CONSTRAINT `RatingReview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RatingReviewLike` ADD CONSTRAINT `RatingReviewLike_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `RatingReview`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RatingReviewLike` ADD CONSTRAINT `RatingReviewLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RatingStats` ADD CONSTRAINT `RatingStats_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RatingStats` ADD CONSTRAINT `RatingStats_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PersonalRanking` ADD CONSTRAINT `PersonalRanking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PersonalRankingItem` ADD CONSTRAINT `PersonalRankingItem_rankingId_fkey` FOREIGN KEY (`rankingId`) REFERENCES `PersonalRanking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PersonalRankingItem` ADD CONSTRAINT `PersonalRankingItem_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PersonalRankingItem` ADD CONSTRAINT `PersonalRankingItem_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicTour` ADD CONSTRAINT `MusicTour_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `MusicConcertCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicConcert` ADD CONSTRAINT `MusicConcert_tourId_fkey` FOREIGN KEY (`tourId`) REFERENCES `MusicTour`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicConcert` ADD CONSTRAINT `MusicConcert_contributorUserId_fkey` FOREIGN KEY (`contributorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicConcert` ADD CONSTRAINT `MusicConcert_setlistContributorUserId_fkey` FOREIGN KEY (`setlistContributorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicConcert` ADD CONSTRAINT `MusicConcert_encoreContributorUserId_fkey` FOREIGN KEY (`encoreContributorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConcertContribution` ADD CONSTRAINT `ConcertContribution_submitterId_fkey` FOREIGN KEY (`submitterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConcertContribution` ADD CONSTRAINT `ConcertContribution_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConcertContribution` ADD CONSTRAINT `ConcertContribution_targetShowId_fkey` FOREIGN KEY (`targetShowId`) REFERENCES `MusicConcert`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserMusicConcert` ADD CONSTRAINT `UserMusicConcert_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserMusicConcert` ADD CONSTRAINT `UserMusicConcert_concertId_fkey` FOREIGN KEY (`concertId`) REFERENCES `MusicConcert`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MyLivePhoto` ADD CONSTRAINT `MyLivePhoto_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MyLivePhoto` ADD CONSTRAINT `MyLivePhoto_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `UserMusicConcert`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicConcertSetlistItem` ADD CONSTRAINT `MusicConcertSetlistItem_concertId_fkey` FOREIGN KEY (`concertId`) REFERENCES `MusicConcert`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicConcertSetlistItem` ADD CONSTRAINT `MusicConcertSetlistItem_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MusicConcertHighlight` ADD CONSTRAINT `MusicConcertHighlight_concertId_fkey` FOREIGN KEY (`concertId`) REFERENCES `MusicConcert`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OnlineSession` ADD CONSTRAINT `OnlineSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PageLayout` ADD CONSTRAINT `PageLayout_publishedById_fkey` FOREIGN KEY (`publishedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PageLayout` ADD CONSTRAINT `PageLayout_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PageLayoutRevision` ADD CONSTRAINT `PageLayoutRevision_pageLayoutId_fkey` FOREIGN KEY (`pageLayoutId`) REFERENCES `PageLayout`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PageLayoutRevision` ADD CONSTRAINT `PageLayoutRevision_publishedById_fkey` FOREIGN KEY (`publishedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PointLog` ADD CONSTRAINT `PointLog_dailyDrawId_fkey` FOREIGN KEY (`dailyDrawId`) REFERENCES `EntertainmentDailyDraw`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PointLog` ADD CONSTRAINT `PointLog_activityRegistrationId_fkey` FOREIGN KEY (`activityRegistrationId`) REFERENCES `ActivityRegistration`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PointLog` ADD CONSTRAINT `PointLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Poll` ADD CONSTRAINT `Poll_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollOption` ADD CONSTRAINT `PollOption_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `Poll`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollVote` ADD CONSTRAINT `PollVote_optionId_fkey` FOREIGN KEY (`optionId`) REFERENCES `PollOption`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollVote` ADD CONSTRAINT `PollVote_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `Poll`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_boardId_fkey` FOREIGN KEY (`boardId`) REFERENCES `Board`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicRecord` ADD CONSTRAINT `ClinicRecord_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicConsultation` ADD CONSTRAINT `ClinicConsultation_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `ClinicRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicConsultation` ADD CONSTRAINT `ClinicConsultation_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicConsultation` ADD CONSTRAINT `ClinicConsultation_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ClinicConsultation`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ClinicAspirin` ADD CONSTRAINT `ClinicAspirin_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicAspirin` ADD CONSTRAINT `ClinicAspirin_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `ClinicRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicAspirin` ADD CONSTRAINT `ClinicAspirin_consultationId_fkey` FOREIGN KEY (`consultationId`) REFERENCES `ClinicConsultation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicMouthpiece` ADD CONSTRAINT `ClinicMouthpiece_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicMouthpiece` ADD CONSTRAINT `ClinicMouthpiece_consultationId_fkey` FOREIGN KEY (`consultationId`) REFERENCES `ClinicConsultation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicReport` ADD CONSTRAINT `ClinicReport_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicReport` ADD CONSTRAINT `ClinicReport_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `ClinicRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicReport` ADD CONSTRAINT `ClinicReport_consultationId_fkey` FOREIGN KEY (`consultationId`) REFERENCES `ClinicConsultation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicReport` ADD CONSTRAINT `ClinicReport_handledById_fkey` FOREIGN KEY (`handledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostModerationHistory` ADD CONSTRAINT `PostModerationHistory_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostModerationHistory` ADD CONSTRAINT `PostModerationHistory_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostFavorite` ADD CONSTRAINT `PostFavorite_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostFavorite` ADD CONSTRAINT `PostFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostMedia` ADD CONSTRAINT `PostMedia_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostTag` ADD CONSTRAINT `PostTag_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostTag` ADD CONSTRAINT `PostTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Profile` ADD CONSTRAINT `Profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileWallLike` ADD CONSTRAINT `ProfileWallLike_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `ProfileWallMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileWallLike` ADD CONSTRAINT `ProfileWallLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileWallMessage` ADD CONSTRAINT `ProfileWallMessage_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ProfileWallMessage`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileWallMessage` ADD CONSTRAINT `ProfileWallMessage_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileWallMessage` ADD CONSTRAINT `ProfileWallMessage_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reply` ADD CONSTRAINT `Reply_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reply` ADD CONSTRAINT `Reply_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reply` ADD CONSTRAINT `Reply_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Reply`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reply` ADD CONSTRAINT `Reply_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplyLike` ADD CONSTRAINT `ReplyLike_replyId_fkey` FOREIGN KEY (`replyId`) REFERENCES `Reply`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplyLike` ADD CONSTRAINT `ReplyLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplyMention` ADD CONSTRAINT `ReplyMention_replyId_fkey` FOREIGN KEY (`replyId`) REFERENCES `Reply`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplyMention` ADD CONSTRAINT `ReplyMention_mentionerId_fkey` FOREIGN KEY (`mentionerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplyMention` ADD CONSTRAINT `ReplyMention_mentionedUserId_fkey` FOREIGN KEY (`mentionedUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_dailyMessageId_fkey` FOREIGN KEY (`dailyMessageId`) REFERENCES `DailyMessage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_replyId_fkey` FOREIGN KEY (`replyId`) REFERENCES `Reply`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SearchHistory` ADD CONSTRAINT `SearchHistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BannedWord` ADD CONSTRAINT `BannedWord_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserCenterShortcutPreference` ADD CONSTRAINT `UserCenterShortcutPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StickerPack` ADD CONSTRAINT `StickerPack_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sticker` ADD CONSTRAINT `Sticker_packId_fkey` FOREIGN KEY (`packId`) REFERENCES `StickerPack`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserStickerPack` ADD CONSTRAINT `UserStickerPack_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserStickerPack` ADD CONSTRAINT `UserStickerPack_packId_fkey` FOREIGN KEY (`packId`) REFERENCES `StickerPack`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StickerFavorite` ADD CONSTRAINT `StickerFavorite_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StickerUsage` ADD CONSTRAINT `StickerUsage_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StickerReport` ADD CONSTRAINT `StickerReport_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StickerReport` ADD CONSTRAINT `StickerReport_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SystemNotification` ADD CONSTRAINT `SystemNotification_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SystemNotificationRead` ADD CONSTRAINT `SystemNotificationRead_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `SystemNotification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SystemNotificationRead` ADD CONSTRAINT `SystemNotificationRead_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_equippedBadgeId_fkey` FOREIGN KEY (`equippedBadgeId`) REFERENCES `Badge`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserPrivacySetting` ADD CONSTRAINT `UserPrivacySetting_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserAchievement` ADD CONSTRAINT `UserAchievement_achievementId_fkey` FOREIGN KEY (`achievementId`) REFERENCES `Achievement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserAchievement` ADD CONSTRAINT `UserAchievement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserAlbumCollection` ADD CONSTRAINT `UserAlbumCollection_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `CultureItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserAlbumCollection` ADD CONSTRAINT `UserAlbumCollection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadge` ADD CONSTRAINT `UserBadge_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadge` ADD CONSTRAINT `UserBadge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadge` ADD CONSTRAINT `UserBadge_grantedBy_fkey` FOREIGN KEY (`grantedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadgeShowcase` ADD CONSTRAINT `UserBadgeShowcase_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadgeShowcase` ADD CONSTRAINT `UserBadgeShowcase_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadgeTracking` ADD CONSTRAINT `UserBadgeTracking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadgeTracking` ADD CONSTRAINT `UserBadgeTracking_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSecurityQuestion` ADD CONSTRAINT `UserSecurityQuestion_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaderboardAdminLog` ADD CONSTRAINT `LeaderboardAdminLog_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaderboardAdminLog` ADD CONSTRAINT `LeaderboardAdminLog_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialPostMedia` ADD CONSTRAINT `SocialPostMedia_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `SocialPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialPostLike` ADD CONSTRAINT `SocialPostLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialPostLike` ADD CONSTRAINT `SocialPostLike_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `SocialPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialPostComment` ADD CONSTRAINT `SocialPostComment_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `SocialPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialPostComment` ADD CONSTRAINT `SocialPostComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialPostComment` ADD CONSTRAINT `SocialPostComment_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `SocialPostComment`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
