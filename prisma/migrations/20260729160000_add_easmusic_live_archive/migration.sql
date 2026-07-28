-- CreateTable
CREATE TABLE `MusicTour` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `subtitle` VARCHAR(191) NULL,
  `description` TEXT NULL,
  `posterUrl` TEXT NULL,
  `startDate` DATETIME(3) NULL,
  `endDate` DATETIME(3) NULL,
  `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicConcert` (
  `id` VARCHAR(191) NOT NULL,
  `tourId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NULL,
  `concertDate` DATETIME(3) NOT NULL,
  `city` VARCHAR(191) NOT NULL,
  `countryOrRegion` VARCHAR(191) NULL,
  `venue` VARCHAR(191) NULL,
  `sessionNumber` VARCHAR(191) NULL,
  `posterUrl` TEXT NULL,
  `description` TEXT NULL,
  `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicConcertSetlistItem` (
  `id` VARCHAR(191) NOT NULL,
  `concertId` VARCHAR(191) NOT NULL,
  `songId` VARCHAR(191) NULL,
  `displayName` VARCHAR(191) NULL,
  `section` ENUM('OPENING', 'MAIN', 'TALK', 'REQUEST', 'ENCORE', 'SPECIAL', 'OTHER') NOT NULL DEFAULT 'MAIN',
  `position` INTEGER NOT NULL,
  `versionName` VARCHAR(191) NULL,
  `note` VARCHAR(191) NULL,
  `isEncore` BOOLEAN NOT NULL DEFAULT false,
  `isRequest` BOOLEAN NOT NULL DEFAULT false,
  `isDebut` BOOLEAN NOT NULL DEFAULT false,
  `isGuest` BOOLEAN NOT NULL DEFAULT false,
  `isMedley` BOOLEAN NOT NULL DEFAULT false,
  `isSpecial` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MusicConcertHighlight` (
  `id` VARCHAR(191) NOT NULL,
  `concertId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `type` ENUM('TALK', 'GUEST', 'SONG', 'STAGE', 'INTERACTION', 'MEMORIAL', 'OTHER') NOT NULL DEFAULT 'OTHER',
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `MusicTour_status_idx` ON `MusicTour`(`status`);
CREATE INDEX `MusicTour_sortOrder_idx` ON `MusicTour`(`sortOrder`);
CREATE INDEX `MusicTour_startDate_idx` ON `MusicTour`(`startDate`);
CREATE INDEX `MusicTour_status_sortOrder_startDate_createdAt_idx` ON `MusicTour`(`status`, `sortOrder`, `startDate`, `createdAt`);
CREATE INDEX `MusicConcert_tourId_idx` ON `MusicConcert`(`tourId`);
CREATE INDEX `MusicConcert_concertDate_idx` ON `MusicConcert`(`concertDate`);
CREATE INDEX `MusicConcert_city_idx` ON `MusicConcert`(`city`);
CREATE INDEX `MusicConcert_status_idx` ON `MusicConcert`(`status`);
CREATE INDEX `MusicConcert_tourId_concertDate_idx` ON `MusicConcert`(`tourId`, `concertDate`);
CREATE INDEX `MusicConcert_status_concertDate_createdAt_idx` ON `MusicConcert`(`status`, `concertDate`, `createdAt`);
CREATE INDEX `MusicConcertSetlistItem_concertId_idx` ON `MusicConcertSetlistItem`(`concertId`);
CREATE INDEX `MusicConcertSetlistItem_songId_idx` ON `MusicConcertSetlistItem`(`songId`);
CREATE INDEX `MusicConcertSetlistItem_concertId_section_position_idx` ON `MusicConcertSetlistItem`(`concertId`, `section`, `position`);
CREATE INDEX `MusicConcertHighlight_concertId_idx` ON `MusicConcertHighlight`(`concertId`);
CREATE INDEX `MusicConcertHighlight_concertId_sortOrder_idx` ON `MusicConcertHighlight`(`concertId`, `sortOrder`);

-- AddForeignKey
ALTER TABLE `MusicConcert` ADD CONSTRAINT `MusicConcert_tourId_fkey`
  FOREIGN KEY (`tourId`) REFERENCES `MusicTour`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MusicConcertSetlistItem` ADD CONSTRAINT `MusicConcertSetlistItem_concertId_fkey`
  FOREIGN KEY (`concertId`) REFERENCES `MusicConcert`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MusicConcertSetlistItem` ADD CONSTRAINT `MusicConcertSetlistItem_songId_fkey`
  FOREIGN KEY (`songId`) REFERENCES `MusicSong`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MusicConcertHighlight` ADD CONSTRAINT `MusicConcertHighlight_concertId_fkey`
  FOREIGN KEY (`concertId`) REFERENCES `MusicConcert`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
