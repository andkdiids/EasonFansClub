-- Keep only profile changes whose old value cannot be reconstructed from the
-- current User row. Other operation history is aggregated from its source
-- tables by the admin user-operation center.
CREATE TABLE `UserOperationLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `summary` VARCHAR(500) NOT NULL,
    `metadata` JSON NULL,
    `source` VARCHAR(32) NOT NULL,
    `operatorType` VARCHAR(16) NOT NULL,
    `operatorUserId` VARCHAR(191) NULL,
    `targetType` VARCHAR(64) NULL,
    `targetId` VARCHAR(191) NULL,
    `riskLevel` VARCHAR(16) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserOperationLog_userId_occurredAt_id_idx`(`userId`, `occurredAt`, `id`),
    INDEX `UserOperationLog_category_occurredAt_id_idx`(`category`, `occurredAt`, `id`),
    INDEX `UserOperationLog_riskLevel_occurredAt_id_idx`(`riskLevel`, `occurredAt`, `id`),
    INDEX `UserOperationLog_operatorUserId_occurredAt_idx`(`operatorUserId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserOperationLog`
    ADD CONSTRAINT `UserOperationLog_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `UserOperationLog`
    ADD CONSTRAINT `UserOperationLog_operatorUserId_fkey`
    FOREIGN KEY (`operatorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
