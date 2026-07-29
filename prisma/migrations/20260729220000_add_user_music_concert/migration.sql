-- CreateTable
CREATE TABLE `UserMusicConcert` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `concertId` VARCHAR(191) NOT NULL,
  `seatInfo` VARCHAR(191) NULL,
  `mood` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `isPublic` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `UserMusicConcert_userId_concertId_key`
  ON `UserMusicConcert`(`userId`, `concertId`);
CREATE INDEX `UserMusicConcert_userId_idx`
  ON `UserMusicConcert`(`userId`);
CREATE INDEX `UserMusicConcert_concertId_idx`
  ON `UserMusicConcert`(`concertId`);
CREATE INDEX `UserMusicConcert_userId_createdAt_idx`
  ON `UserMusicConcert`(`userId`, `createdAt`);
CREATE INDEX `UserMusicConcert_concertId_isPublic_idx`
  ON `UserMusicConcert`(`concertId`, `isPublic`);

-- AddForeignKey
ALTER TABLE `UserMusicConcert` ADD CONSTRAINT `UserMusicConcert_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserMusicConcert` ADD CONSTRAINT `UserMusicConcert_concertId_fkey`
  FOREIGN KEY (`concertId`) REFERENCES `MusicConcert`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
