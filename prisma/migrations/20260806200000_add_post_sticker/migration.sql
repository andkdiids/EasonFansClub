-- AlterTable: Post 关联表情（帖子正文可发送表情包）
ALTER TABLE `Post`
  ADD COLUMN `stickerId` VARCHAR(191),
  ADD INDEX `Post_stickerId_idx` (`stickerId`);

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `Sticker` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
