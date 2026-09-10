-- Keep artist identity separate from user profiles while allowing public studio
-- projects to be grouped under an artist page.
CREATE TABLE `Artist` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `avatar` TEXT NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Artist_slug_key`(`slug`),
    INDEX `Artist_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StudioProject`
    ADD COLUMN `artistId` VARCHAR(191) NULL;

CREATE INDEX `StudioProject_artistId_updatedAt_idx`
    ON `StudioProject`(`artistId`, `updatedAt`);

ALTER TABLE `StudioProject`
    ADD CONSTRAINT `StudioProject_artistId_fkey`
    FOREIGN KEY (`artistId`) REFERENCES `Artist`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The existing beads tool is the Beethoven & Me product. Seed the first
-- artist row and attach existing beads projects without touching user data.
INSERT INTO `Artist` (`id`, `slug`, `name`, `avatar`, `description`, `createdAt`, `updatedAt`)
VALUES ('beethoven', 'beethoven', '贝多芬', NULL, '德国作曲家，古典音乐代表人物。', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `description` = VALUES(`description`),
    `updatedAt` = CURRENT_TIMESTAMP(3);

UPDATE `StudioProject`
SET `artistId` = 'beethoven'
WHERE `toolSlug` = 'beads' AND `artistId` IS NULL;
