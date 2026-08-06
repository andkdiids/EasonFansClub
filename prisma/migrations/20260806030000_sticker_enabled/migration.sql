-- AlterTable: Sticker 增加 enabled（官方表情上架/下架，独立于违规隐藏 isHidden）
ALTER TABLE `Sticker`
  ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD INDEX `Sticker_enabled_idx` (`enabled`);
