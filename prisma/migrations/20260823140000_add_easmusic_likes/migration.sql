-- EasMusic 内容点赞：关系绑定 MusicSong/MusicAlbum，不绑定每日推荐记录。
-- 不维护冗余 likeCount；读取时通过关系表聚合统计。

CREATE TABLE `MusicSongLike` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `songId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MusicSongLike_userId_songId_key`(`userId`, `songId`),
    INDEX `MusicSongLike_songId_idx`(`songId`),
    INDEX `MusicSongLike_userId_idx`(`userId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MusicSongLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `MusicSongLike_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MusicAlbumLike` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `albumId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MusicAlbumLike_userId_albumId_key`(`userId`, `albumId`),
    INDEX `MusicAlbumLike_albumId_idx`(`albumId`),
    INDEX `MusicAlbumLike_userId_idx`(`userId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MusicAlbumLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `MusicAlbumLike_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `MusicAlbum`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
