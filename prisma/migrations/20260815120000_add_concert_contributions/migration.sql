-- Store user-submitted concert archive material separately until an administrator publishes it.
ALTER TABLE `MusicConcert`
  ADD COLUMN `contributorUserId` VARCHAR(191) NULL,
  ADD COLUMN `contributionId` VARCHAR(191) NULL,
  ADD COLUMN `setlistContributorUserId` VARCHAR(191) NULL,
  ADD COLUMN `setlistContributionId` VARCHAR(191) NULL,
  ADD COLUMN `encoreContributorUserId` VARCHAR(191) NULL,
  ADD COLUMN `encoreContributionId` VARCHAR(191) NULL;

CREATE INDEX `MusicConcert_tourId_city_concertDate_idx`
  ON `MusicConcert`(`tourId`, `city`, `concertDate`);

CREATE TABLE `ConcertContribution` (
  `id` VARCHAR(191) NOT NULL,
  `type` ENUM('SHOW', 'SETLIST', 'ENCORE') NOT NULL,
  `submitterId` VARCHAR(191) NOT NULL,
  `targetShowId` VARCHAR(191) NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
  `reviewerId` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewNote` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ConcertContribution_submitterId_status_createdAt_idx`
  ON `ConcertContribution`(`submitterId`, `status`, `createdAt`);
CREATE INDEX `ConcertContribution_status_type_createdAt_idx`
  ON `ConcertContribution`(`status`, `type`, `createdAt`);
CREATE INDEX `ConcertContribution_targetShowId_type_status_idx`
  ON `ConcertContribution`(`targetShowId`, `type`, `status`);

ALTER TABLE `MusicConcert`
  ADD CONSTRAINT `MusicConcert_contributorUserId_fkey`
    FOREIGN KEY (`contributorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `MusicConcert_setlistContributorUserId_fkey`
    FOREIGN KEY (`setlistContributorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `MusicConcert_encoreContributorUserId_fkey`
    FOREIGN KEY (`encoreContributorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ConcertContribution`
  ADD CONSTRAINT `ConcertContribution_submitterId_fkey`
    FOREIGN KEY (`submitterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ConcertContribution_reviewerId_fkey`
    FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ConcertContribution_targetShowId_fkey`
    FOREIGN KEY (`targetShowId`) REFERENCES `MusicConcert`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
