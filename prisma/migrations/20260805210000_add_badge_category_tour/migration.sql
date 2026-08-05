-- EasMusic 演唱会徽章系统
-- 为 Badge 增加分类(category)与可选的巡演关联(musicTourId)：
--   - 现有徽章默认归为 SYSTEM，保持向后兼容；
--   - 生日纪念徽章的语义分类在 seed.ts 中修正为 BIRTHDAY；
--   - 演唱会纪念徽章由管理员创建时写入 category=CONCERT 并关联 MusicTour。
-- 徽章授予复用既有 UserBadge(userId, badgeId) 唯一约束，无需新增表。

ALTER TABLE `Badge`
  ADD COLUMN `category` ENUM('SYSTEM', 'BIRTHDAY', 'CONCERT') NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN `musicTourId` VARCHAR(191),
  ADD INDEX `Badge_category_idx` (`category`),
  ADD INDEX `Badge_musicTourId_idx` (`musicTourId`);

ALTER TABLE `Badge`
  ADD CONSTRAINT `Badge_musicTourId_fkey`
  FOREIGN KEY (`musicTourId`) REFERENCES `MusicTour` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
