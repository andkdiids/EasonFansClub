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

  UNIQUE INDEX `ReplyMention_replyId_mentionedUserId_key`(`replyId`, `mentionedUserId`),
  INDEX `ReplyMention_mentionerId_createdAt_idx`(`mentionerId`, `createdAt`),
  INDEX `ReplyMention_mentionedUserId_createdAt_idx`(`mentionedUserId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Post_trending_window_idx` ON `Post`(`status`, `isDeleted`, `createdAt`);

-- AddForeignKey
ALTER TABLE `ReplyMention` ADD CONSTRAINT `ReplyMention_replyId_fkey`
  FOREIGN KEY (`replyId`) REFERENCES `Reply`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplyMention` ADD CONSTRAINT `ReplyMention_mentionerId_fkey`
  FOREIGN KEY (`mentionerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplyMention` ADD CONSTRAINT `ReplyMention_mentionedUserId_fkey`
  FOREIGN KEY (`mentionedUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
