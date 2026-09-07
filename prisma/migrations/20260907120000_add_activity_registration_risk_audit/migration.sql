-- First-phase activity risk audit signals. Raw IP/device values are never persisted.
ALTER TABLE `ActivityRegistration`
  ADD COLUMN `registrationIpHash` VARCHAR(128) NULL,
  ADD COLUMN `registrationUserAgent` VARCHAR(500) NULL,
  ADD COLUMN `registrationDeviceId` VARCHAR(128) NULL,
  ADD COLUMN `registrationRequestId` VARCHAR(128) NULL,
  ADD INDEX `ActivityRegistration_activityDevice_idx` (`activityId`, `registrationDeviceId`),
  ADD INDEX `ActivityRegistration_activityIpHashRegisteredAt_idx` (`activityId`, `registrationIpHash`, `registeredAt`);

CREATE TABLE `ActivityLotteryCandidateSnapshot` (
  `id` VARCHAR(191) NOT NULL,
  `lotteryId` VARCHAR(191) NOT NULL,
  `registrationId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `eligibleAtDraw` BOOLEAN NOT NULL DEFAULT true,
  `snapshotAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ActivityLotteryCandidateSnapshot_lotteryId_registrationId_key` (`lotteryId`, `registrationId`),
  INDEX `ActivityLotteryCandidateSnapshot_lotteryId_userId_idx` (`lotteryId`, `userId`),
  INDEX `ActivityLotteryCandidateSnapshot_registrationId_idx` (`registrationId`),
  CONSTRAINT `ActivityLotteryCandidateSnapshot_lotteryId_fkey`
    FOREIGN KEY (`lotteryId`) REFERENCES `Lottery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ActivityLotteryCandidateSnapshot_registrationId_fkey`
    FOREIGN KEY (`registrationId`) REFERENCES `ActivityRegistration`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ActivityLotteryCandidateSnapshot_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
