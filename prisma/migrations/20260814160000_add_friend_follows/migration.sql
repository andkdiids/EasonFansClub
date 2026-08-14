-- CreateTable
CREATE TABLE `FriendFollow` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `followerId` VARCHAR(191) NOT NULL,
    `followedId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `FriendFollow_followerId_followedId_key` ON `FriendFollow`(`followerId`, `followedId`);

-- CreateIndex
CREATE INDEX `FriendFollow_followerId_createdAt_idx` ON `FriendFollow`(`followerId`, `createdAt`);

-- CreateIndex
CREATE INDEX `FriendFollow_followedId_idx` ON `FriendFollow`(`followedId`);

-- AddForeignKey
ALTER TABLE `FriendFollow` ADD CONSTRAINT `FriendFollow_followerId_fkey` FOREIGN KEY (`followerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendFollow` ADD CONSTRAINT `FriendFollow_followedId_fkey` FOREIGN KEY (`followedId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
