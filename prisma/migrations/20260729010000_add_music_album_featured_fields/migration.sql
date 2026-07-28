-- AlterTable
ALTER TABLE `MusicAlbum`
  ADD COLUMN `isFeatured` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `featuredOrder` INTEGER NULL;

-- CreateIndex
CREATE INDEX `MusicAlbum_status_isFeatured_featuredOrder_createdAt_idx`
  ON `MusicAlbum`(`status`, `isFeatured`, `featuredOrder`, `createdAt`);
