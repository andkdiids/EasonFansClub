-- AlterTable
ALTER TABLE `MusicSong`
    ADD COLUMN `previewUrl` VARCHAR(191) NULL,
    ADD COLUMN `previewDuration` INTEGER NOT NULL DEFAULT 7;
