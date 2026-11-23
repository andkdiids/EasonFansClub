-- AlterTable
ALTER TABLE `PointLog` MODIFY `action` ENUM('POST_CREATE', 'REPLY_CREATE', 'DAILY_CHECK_IN', 'POST_LIKE_RECEIVED', 'ADMIN_ADJUST', 'REGISTER', 'LOGIN', 'CONTINUOUS_CHECK_IN_BONUS', 'FEATURED_POST', 'ACTIVITY_REWARD', 'BADGE_EXCHANGE', 'ENTERTAINMENT_DAILY_DRAW', 'POST_DAILY_FIRST', 'POST_COMMENT_DAILY', 'POST_COMMENT_RECEIVED', 'COMMENT_POST', 'COMMENT_REVOKE', 'GUESS_SONG_DUEL_WIN', 'USER_REWARD', 'CHECK_IN_MAKEUP', 'MATERIAL_REDEMPTION', 'MATERIAL_REDEMPTION_REFUND', 'ACTIVITY_REGISTRATION_FEE', 'ACTIVITY_REGISTRATION_REFUND', 'ACTIVITY_LOTTERY_PRIZE', 'PHARMACY_DRAW_COST', 'PHARMACY_PRIZE_REWARD', 'PHARMACY_DUPLICATE_RECYCLE', 'GROWTH_REWARD', 'GROWTH_REWARD_REVERSAL', 'GLOBAL_POINTS_GRANT', 'TOPIC_ACTIVITY_REWARD', 'SHUN_STEAL', 'SHUN_RECOVERY', 'SHUN_COMPENSATION') NOT NULL;

-- CreateTable
CREATE TABLE `ShunMasterSettings` (
    `id` INTEGER NOT NULL,
    `config` JSON NOT NULL,
    `reserved` INTEGER NOT NULL DEFAULT 0,
    `compensated` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunMasterMember` (
    `userId` VARCHAR(191) NOT NULL,
    `joined` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunMasterRound` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `victimId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(36) NOT NULL,
    `day` CHAR(10) NOT NULL,
    `rolled` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `goldenUntil` DATETIME(3) NOT NULL,
    `candidates` JSON NOT NULL,
    `goldenDecoyId` VARCHAR(191) NULL,
    `result` VARCHAR(10) NULL,
    `mode` INTEGER NULL,
    `selectedId` VARCHAR(191) NULL,
    `recovered` INTEGER NOT NULL DEFAULT 0,
    `compensation` INTEGER NOT NULL DEFAULT 0,
    `capturedAt` DATETIME(3) NULL,

    INDEX `ShunMasterRound_victimId_day_idx`(`victimId`, `day`),
    INDEX `ShunMasterRound_victimId_createdAt_id_idx`(`victimId`, `createdAt`, `id`),
    INDEX `ShunMasterRound_actorId_createdAt_id_idx`(`actorId`, `createdAt`, `id`),
    INDEX `ShunMasterRound_day_idx`(`day`),
    UNIQUE INDEX `ShunMasterRound_actorId_requestId_key`(`actorId`, `requestId`),
    UNIQUE INDEX `ShunMasterRound_actorId_day_victimId_key`(`actorId`, `day`, `victimId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `ShunMasterSettings` (`id`, `config`) VALUES (
    1, JSON_OBJECT('enabled', CAST('false' AS JSON), 'attempts', 7, 'victimCap', 4,
        'goldenMinutes', 10, 'budget', 1000, 'probabilities', JSON_ARRAY(25, 21, 17, 14, 10, 7, 6),
        'weights', JSON_ARRAY(130, 122, 115, 108, 100))
);
