-- 为 MusicTour 新增 categoryId，关联到可配置的 MusicConcertCategory 表。
-- 保留 category 枚举字段兼容旧数据：用本迁移把历史枚举值自动映射到对应分类（slug 固定 main/small/guest）。
-- 未执行 migrate deploy：本文件仅准备，待部署时由 `prisma migrate deploy` 应用（部署前置动作）。

-- 新增关联字段（允许为空，便于旧行在映射前过渡）。
ALTER TABLE `MusicTour` ADD COLUMN `categoryId` VARCHAR(191) NULL;

-- 自动映射：旧枚举 MAIN/SMALL/GUEST -> 对应分类的 id（slug 固定 main/small/guest）。
UPDATE `MusicTour` SET `categoryId` = (SELECT `id` FROM `MusicConcertCategory` WHERE `slug` = 'main' LIMIT 1) WHERE `category` = 'MAIN';
UPDATE `MusicTour` SET `categoryId` = (SELECT `id` FROM `MusicConcertCategory` WHERE `slug` = 'small' LIMIT 1) WHERE `category` = 'SMALL';
UPDATE `MusicTour` SET `categoryId` = (SELECT `id` FROM `MusicConcertCategory` WHERE `slug` = 'guest' LIMIT 1) WHERE `category` = 'GUEST';

-- 外键：分类（预留项受保护不可删）被删时置空，正常不会触发。
ALTER TABLE `MusicTour` ADD CONSTRAINT `MusicTour_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `MusicConcertCategory` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 索引。
CREATE INDEX `MusicTour_categoryId_idx` ON `MusicTour` (`categoryId`);
