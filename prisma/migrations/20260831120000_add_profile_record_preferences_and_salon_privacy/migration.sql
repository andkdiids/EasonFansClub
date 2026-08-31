ALTER TABLE `UserPrivacySetting`
  ADD COLUMN `showSalon` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `ProfileRecordPreference` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `section` VARCHAR(32) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `isVisible` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ProfileRecordPreference_userId_section_key` (`userId`, `section`),
  INDEX `ProfileRecordPreference_userId_sortOrder_idx` (`userId`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProfileRecordPreference`
  ADD CONSTRAINT `ProfileRecordPreference_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
