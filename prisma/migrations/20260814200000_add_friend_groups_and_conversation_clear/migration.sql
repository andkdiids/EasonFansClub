-- Add per-user conversation clearing and private friend groups.
ALTER TABLE `ConversationParticipant`
  ADD COLUMN `clearedAt` DATETIME(3) NULL;

CREATE TABLE `FriendGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(30) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `FriendGroup_ownerId_name_key` ON `FriendGroup`(`ownerId`, `name`);
CREATE INDEX `FriendGroup_ownerId_sortOrder_createdAt_idx` ON `FriendGroup`(`ownerId`, `sortOrder`, `createdAt`);

CREATE TABLE `FriendGroupMember` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ownerId` VARCHAR(191) NOT NULL,
    `friendId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `FriendGroupMember_ownerId_friendId_key` ON `FriendGroupMember`(`ownerId`, `friendId`);
CREATE INDEX `FriendGroupMember_groupId_idx` ON `FriendGroupMember`(`groupId`);
CREATE INDEX `FriendGroupMember_friendId_idx` ON `FriendGroupMember`(`friendId`);

ALTER TABLE `FriendGroup`
  ADD CONSTRAINT `FriendGroup_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `FriendGroupMember`
  ADD CONSTRAINT `FriendGroupMember_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `FriendGroupMember_friendId_fkey` FOREIGN KEY (`friendId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `FriendGroupMember_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `FriendGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
