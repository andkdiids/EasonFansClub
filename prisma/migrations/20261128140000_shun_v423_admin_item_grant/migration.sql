-- V4.2.3 后台全站道具发放：
-- 1) 新增可区分的获取来源 ADMIN_GRANT，不得伪装成主线/社区/赠礼。
-- 2) 发放任务 / 发放明细 / 用户级发放记录三张表，支持分批执行、断点恢复、幂等与失败重试。
-- 历史道具流水与库存不受影响，迁移为纯增量。

-- AlterTable: 新增管理员发放事件类型
ALTER TABLE `ShunItemEntry`
    MODIFY `type` ENUM('DAILY_MAIN', 'COMMUNITY_DROP', 'WEEKLY_REWARD', 'GIFT_RECEIVED', 'USED', 'GIFT_SENT', 'GIFT_REWARD', 'ADMIN_GRANT', 'RESERVED', 'RELEASED') NOT NULL;

-- CreateTable
CREATE TABLE `ShunItemGrantTask` (
    `id` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `notify` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `configVersion` INTEGER NOT NULL,
    `totalUsers` INTEGER NOT NULL DEFAULT 0,
    `totalItems` INTEGER NOT NULL DEFAULT 0,
    `succeededUsers` INTEGER NOT NULL DEFAULT 0,
    `failedUsers` INTEGER NOT NULL DEFAULT 0,
    `skippedUsers` INTEGER NOT NULL DEFAULT 0,
    `grantedItems` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,

    UNIQUE INDEX `ShunItemGrantTask_idempotencyKey_key`(`idempotencyKey`),
    INDEX `ShunItemGrantTask_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemGrantTaskItem` (
    `taskId` VARCHAR(191) NOT NULL,
    `code` ENUM('EXTRA_ATTEMPT', 'FRIEND_GIFT', 'EXTRA_SUSPECT', 'REVENGE', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE') NOT NULL,
    `quantity` INTEGER NOT NULL,

    PRIMARY KEY (`taskId`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemGrant` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `failureReason` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ShunItemGrant_taskId_userId_key`(`taskId`, `userId`),
    INDEX `ShunItemGrant_taskId_status_userId_idx`(`taskId`, `status`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ShunItemGrantTaskItem` ADD CONSTRAINT `ShunItemGrantTaskItem_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `ShunItemGrantTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShunItemGrant` ADD CONSTRAINT `ShunItemGrant_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `ShunItemGrantTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
