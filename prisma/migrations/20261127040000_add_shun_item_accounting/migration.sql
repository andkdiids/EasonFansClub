-- CreateTable
CREATE TABLE `ShunItemConfigVersion` (
    `version` INTEGER NOT NULL AUTO_INCREMENT,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `rules` JSON NOT NULL,

    PRIMARY KEY (`version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemDefinition` (
    `version` INTEGER NOT NULL,
    `code` ENUM('EXTRA_ATTEMPT', 'FRIEND_GIFT', 'EXTRA_SUSPECT', 'REVENGE', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE') NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(512) NOT NULL,
    `icon` VARCHAR(64) NOT NULL,
    `rarity` VARCHAR(16) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `weight` INTEGER NOT NULL,

    PRIMARY KEY (`version`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemInventory` (
    `userId` VARCHAR(191) NOT NULL,
    `code` ENUM('EXTRA_ATTEMPT', 'FRIEND_GIFT', 'EXTRA_SUSPECT', 'REVENGE', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE') NOT NULL,
    `available` INTEGER NOT NULL DEFAULT 0,
    `pending` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemPending` (
    `userId` VARCHAR(191) NOT NULL,
    `code` ENUM('EXTRA_ATTEMPT', 'FRIEND_GIFT', 'EXTRA_SUSPECT', 'REVENGE', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE') NOT NULL,
    `day` CHAR(10) NOT NULL,
    `reservationId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ShunItemPending_reservationId_key`(`reservationId`),
    INDEX `ShunItemPending_day_idx`(`day`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemEntry` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(191) NOT NULL,
    `code` ENUM('EXTRA_ATTEMPT', 'FRIEND_GIFT', 'EXTRA_SUSPECT', 'REVENGE', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE') NOT NULL,
    `type` ENUM('DAILY_MAIN', 'COMMUNITY_DROP', 'WEEKLY_REWARD', 'GIFT_RECEIVED', 'USED', 'GIFT_SENT', 'RESERVED', 'RELEASED') NOT NULL,
    `availableDelta` INTEGER NOT NULL,
    `pendingDelta` INTEGER NOT NULL,
    `configVersion` INTEGER NOT NULL,
    `day` CHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ShunItemEntry_userId_createdAt_id_idx`(`userId`, `createdAt`, `id`),
    INDEX `ShunItemEntry_day_type_idx`(`day`, `type`),
    UNIQUE INDEX `ShunItemEntry_userId_type_requestKey_key`(`userId`, `type`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemDaily` (
    `userId` VARCHAR(191) NOT NULL,
    `day` CHAR(10) NOT NULL,
    `mainGranted` BOOLEAN NOT NULL DEFAULT false,
    `behaviorGranted` BOOLEAN NOT NULL DEFAULT false,
    `giftsReceived` INTEGER NOT NULL DEFAULT 0,
    `extraAttemptsGranted` INTEGER NOT NULL DEFAULT 0,
    `extraAttemptsUsed` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemDailyCounter` (
    `userId` VARCHAR(191) NOT NULL,
    `day` CHAR(10) NOT NULL,
    `counter` VARCHAR(32) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`, `day`, `counter`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemWeeklyGrant` (
    `userId` VARCHAR(191) NOT NULL,
    `weekStart` CHAR(10) NOT NULL,
    `milestone` INTEGER NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ShunItemWeeklyGrant_entryId_key`(`entryId`),
    PRIMARY KEY (`userId`, `weekStart`, `milestone`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemGift` (
    `id` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `sentEntryId` VARCHAR(191) NOT NULL,
    `receivedEntryId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShunItemGift_sentEntryId_key`(`sentEntryId`),
    UNIQUE INDEX `ShunItemGift_receivedEntryId_key`(`receivedEntryId`),
    INDEX `ShunItemGift_senderId_createdAt_idx`(`senderId`, `createdAt`),
    INDEX `ShunItemGift_receiverId_createdAt_idx`(`receiverId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShunItemRoundEffect` (
    `roundId` VARCHAR(191) NOT NULL,
    `code` ENUM('EXTRA_ATTEMPT', 'FRIEND_GIFT', 'EXTRA_SUSPECT', 'REVENGE', 'TARGET_FRIEND', 'DOUBLE_AMOUNT', 'RETRY_CAPTURE') NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL DEFAULT 0,
    `compensation` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShunItemRoundEffect_entryId_key`(`entryId`),
    PRIMARY KEY (`roundId`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ShunItemDefinition` ADD CONSTRAINT `ShunItemDefinition_version_fkey` FOREIGN KEY (`version`) REFERENCES `ShunItemConfigVersion`(`version`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShunItemEntry` ADD CONSTRAINT `ShunItemEntry_configVersion_fkey` FOREIGN KEY (`configVersion`) REFERENCES `ShunItemConfigVersion`(`version`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShunItemRoundEffect` ADD CONSTRAINT `ShunItemRoundEffect_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `ShunMasterRound`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE `ShunItemInventory`
  ADD CONSTRAINT `ShunItemInventory_nonnegative` CHECK (`available` >= 0 AND `pending` >= 0);

ALTER TABLE `ShunItemDaily`
  ADD CONSTRAINT `ShunItemDaily_valid_counts` CHECK (
    `giftsReceived` >= 0 AND `extraAttemptsGranted` >= 0
    AND `extraAttemptsUsed` >= 0 AND `extraAttemptsUsed` <= `extraAttemptsGranted`
  );

ALTER TABLE `ShunItemDailyCounter`
  ADD CONSTRAINT `ShunItemDailyCounter_nonnegative` CHECK (`count` >= 0);

ALTER TABLE `ShunItemEntry`
  ADD CONSTRAINT `ShunItemEntry_nonzero` CHECK (`availableDelta` <> 0 OR `pendingDelta` <> 0);

ALTER TABLE `ShunItemWeeklyGrant`
  ADD CONSTRAINT `ShunItemWeeklyGrant_entry_fkey`
  FOREIGN KEY (`entryId`) REFERENCES `ShunItemEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ShunItemGift`
  ADD CONSTRAINT `ShunItemGift_distinct_users` CHECK (`senderId` <> `receiverId`),
  ADD CONSTRAINT `ShunItemGift_sentEntry_fkey`
  FOREIGN KEY (`sentEntryId`) REFERENCES `ShunItemEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ShunItemGift_receivedEntry_fkey`
  FOREIGN KEY (`receivedEntryId`) REFERENCES `ShunItemEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ShunItemRoundEffect`
  ADD CONSTRAINT `ShunItemRoundEffect_entry_fkey`
  FOREIGN KEY (`entryId`) REFERENCES `ShunItemEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
