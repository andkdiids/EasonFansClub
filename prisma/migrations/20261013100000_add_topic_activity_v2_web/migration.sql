-- Additive only. Existing activity/review/reward records are not rewritten.
ALTER TABLE `Activity` ADD COLUMN `topicProgram` JSON NULL;
ALTER TABLE `TopicActivitySubmission` ADD COLUMN `rewardEntryId` VARCHAR(191) NULL,
    ADD COLUMN `rewardSnapshot` JSON NULL;
ALTER TABLE `TopicActivityImageAsset` ADD COLUMN `taskSubmissionId` VARCHAR(191) NULL;
ALTER TABLE `TopicActivityRewardGrant` ADD COLUMN `origin` VARCHAR(16) NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN `rewardEntryId` VARCHAR(191) NULL,
    ADD COLUMN `rewardSnapshot` JSON NULL;

CREATE TABLE `TopicActivityRewardEntry` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `platformKey` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `TopicActivityRewardEntry_activityId_enabled_sortOrder_idx`(`activityId`, `enabled`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TopicActivityPollVote` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `pollId` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `configVersion` INTEGER NOT NULL,
    `choices` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `TopicPoll_activity_poll_user_key`(`activityId`, `pollId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TopicActivityTestAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `testId` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(64) NOT NULL,
    `configVersion` INTEGER NOT NULL,
    `answers` JSON NOT NULL,
    `resultId` VARCHAR(64) NOT NULL,
    `resultSnapshot` JSON NOT NULL,
    `completedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `TopicActivityTestAttempt_activityId_testId_userId_completedA_idx`(`activityId`, `testId`, `userId`, `completedAt`),
    UNIQUE INDEX `TopicTest_activity_user_request_key`(`activityId`, `userId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `TopicActivitySubmission_activityId_rewardEntryId_userId_idx` ON `TopicActivitySubmission`(`activityId`, `rewardEntryId`, `userId`);
CREATE INDEX `TopicActivityImageAsset_taskSubmissionId_idx` ON `TopicActivityImageAsset`(`taskSubmissionId`);
CREATE UNIQUE INDEX `TopicReward_activity_entry_user_key` ON `TopicActivityRewardGrant`(`activityId`, `rewardEntryId`, `userId`);

ALTER TABLE `TopicActivitySubmission` ADD CONSTRAINT `TopicActivitySubmission_rewardEntryId_fkey` FOREIGN KEY (`rewardEntryId`) REFERENCES `TopicActivityRewardEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TopicActivityImageAsset` ADD CONSTRAINT `TopicActivityImageAsset_taskSubmissionId_fkey` FOREIGN KEY (`taskSubmissionId`) REFERENCES `TopicActivitySubmission`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `TopicActivityRewardGrant` ADD CONSTRAINT `TopicActivityRewardGrant_rewardEntryId_fkey` FOREIGN KEY (`rewardEntryId`) REFERENCES `TopicActivityRewardEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TopicActivityRewardEntry` ADD CONSTRAINT `TopicActivityRewardEntry_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TopicActivityPollVote` ADD CONSTRAINT `TopicActivityPollVote_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TopicActivityPollVote` ADD CONSTRAINT `TopicActivityPollVote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TopicActivityTestAttempt` ADD CONSTRAINT `TopicActivityTestAttempt_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `Activity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TopicActivityTestAttempt` ADD CONSTRAINT `TopicActivityTestAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
