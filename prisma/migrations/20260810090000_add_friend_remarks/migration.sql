-- CreateTable
CREATE TABLE `FriendRemark` (
    `id` VARCHAR(191) NOT NULL,
    `remark` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `friendId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `FriendRemark_ownerId_friendId_key` ON `FriendRemark` (`ownerId`, `friendId`);

-- CreateIndex
CREATE INDEX `FriendRemark_friendId_idx` ON `FriendRemark` (`friendId`);

-- AddForeignKey
ALTER TABLE `FriendRemark` ADD CONSTRAINT `FriendRemark_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendRemark` ADD CONSTRAINT `FriendRemark_friendId_fkey` FOREIGN KEY (`friendId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
