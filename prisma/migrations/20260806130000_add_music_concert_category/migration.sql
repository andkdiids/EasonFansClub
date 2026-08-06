-- 新增「演唱会分类」可配置表（MusicConcertCategory）。
-- 三大核心分类 slug 固定为 main / small / guest，与 MusicTour.category 枚举一一对应。
-- 旧数据无需迁移：MusicTour 仍使用 category 枚举，天然落在三大核心分类中。

-- CreateTable
CREATE TABLE `MusicConcertCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `MusicConcertCategory_slug_key` ON `MusicConcertCategory` (`slug`);

-- CreateIndex
CREATE INDEX `MusicConcertCategory_sortOrder_idx` ON `MusicConcertCategory` (`sortOrder`);

-- 预置三大核心分类（与音乐会分类枚举 MAIN / SMALL / GUEST 对应）。
INSERT INTO `MusicConcertCategory` (`id`, `name`, `slug`, `sortOrder`, `enabled`, `createdAt`, `updatedAt`) VALUES
  (UUID(), '大型演唱会', 'main', 1, TRUE, NOW(), NOW()),
  (UUID(), '小型企划', 'small', 2, TRUE, NOW(), NOW()),
  (UUID(), '嘉宾现场', 'guest', 3, TRUE, NOW(), NOW());
