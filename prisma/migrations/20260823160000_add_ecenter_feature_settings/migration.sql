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
