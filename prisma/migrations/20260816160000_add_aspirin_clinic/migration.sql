CREATE TABLE `ClinicRecord` (
  `id` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `category` ENUM('WORK_INJURY', 'HEARTBREAK', 'LIFE_IS_NOT_WORTH_IT', 'EASON_AFTEREFFECT', 'JUSTICE', 'LOW_PRESSURE', 'GOOD_TODAY', 'ASK_DOCTORS', 'TREE_HOLE') NOT NULL,
  `needType` ENUM('JUST_LISTEN', 'WAKE_ME_UP', 'GIVE_ADVICE', 'FIND_SOMEONE_SAME', 'ROAST_WITH_ME', 'CASUAL_CHAT') NOT NULL,
  `identityMode` ENUM('PUBLIC', 'ANONYMOUS') NOT NULL DEFAULT 'PUBLIC',
  `anonymousNumber` INTEGER NOT NULL,
  `status` ENUM('ACTIVE', 'HIDDEN', 'DELETED', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
  `aspirinCount` INTEGER NOT NULL DEFAULT 0,
  `consultationCount` INTEGER NOT NULL DEFAULT 0,
  `mouthpieceCount` INTEGER NOT NULL DEFAULT 0,
  `moderationReason` VARCHAR(191) NULL,
  `matchedBannedWords` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,

  INDEX `ClinicRecord_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `ClinicRecord_category_status_createdAt_idx` (`category`, `status`, `createdAt`),
  INDEX `ClinicRecord_authorId_createdAt_idx` (`authorId`, `createdAt`),
  INDEX `ClinicRecord_consultationCount_idx` (`consultationCount`),
  INDEX `ClinicRecord_aspirinCount_idx` (`aspirinCount`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ClinicRecord_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ClinicConsultation` (
  `id` VARCHAR(191) NOT NULL,
  `recordId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `identityMode` ENUM('PUBLIC', 'ANONYMOUS') NOT NULL DEFAULT 'PUBLIC',
  `anonymousNumber` INTEGER NOT NULL,
  `parentId` VARCHAR(191) NULL,
  `aspirinCount` INTEGER NOT NULL DEFAULT 0,
  `mouthpieceCount` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE', 'HIDDEN', 'DELETED', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
  `moderationReason` VARCHAR(191) NULL,
  `matchedBannedWords` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,

  INDEX `ClinicConsultation_recordId_status_createdAt_idx` (`recordId`, `status`, `createdAt`),
  INDEX `ClinicConsultation_recordId_parentId_status_createdAt_idx` (`recordId`, `parentId`, `status`, `createdAt`),
  INDEX `ClinicConsultation_authorId_createdAt_idx` (`authorId`, `createdAt`),
  INDEX `ClinicConsultation_mouthpieceCount_createdAt_idx` (`mouthpieceCount`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ClinicConsultation_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `ClinicRecord` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ClinicConsultation_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ClinicConsultation_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ClinicConsultation` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ClinicAspirin` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `recordId` VARCHAR(191) NULL,
  `consultationId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ClinicAspirin_userId_recordId_key` (`userId`, `recordId`),
  UNIQUE INDEX `ClinicAspirin_userId_consultationId_key` (`userId`, `consultationId`),
  INDEX `ClinicAspirin_recordId_createdAt_idx` (`recordId`, `createdAt`),
  INDEX `ClinicAspirin_consultationId_createdAt_idx` (`consultationId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ClinicAspirin_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ClinicAspirin_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `ClinicRecord` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ClinicAspirin_consultationId_fkey` FOREIGN KEY (`consultationId`) REFERENCES `ClinicConsultation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ClinicMouthpiece` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `consultationId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ClinicMouthpiece_userId_consultationId_key` (`userId`, `consultationId`),
  INDEX `ClinicMouthpiece_consultationId_createdAt_idx` (`consultationId`, `createdAt`),
  INDEX `ClinicMouthpiece_userId_createdAt_idx` (`userId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ClinicMouthpiece_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ClinicMouthpiece_consultationId_fkey` FOREIGN KEY (`consultationId`) REFERENCES `ClinicConsultation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ClinicReport` (
  `id` VARCHAR(191) NOT NULL,
  `reporterId` VARCHAR(191) NOT NULL,
  `recordId` VARCHAR(191) NULL,
  `consultationId` VARCHAR(191) NULL,
  `reason` VARCHAR(191) NOT NULL,
  `detail` TEXT NULL,
  `status` ENUM('PENDING', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `handledById` VARCHAR(191) NULL,
  `handledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ClinicReport_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `ClinicReport_recordId_createdAt_idx` (`recordId`, `createdAt`),
  INDEX `ClinicReport_consultationId_createdAt_idx` (`consultationId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ClinicReport_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ClinicReport_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `ClinicRecord` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ClinicReport_consultationId_fkey` FOREIGN KEY (`consultationId`) REFERENCES `ClinicConsultation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ClinicReport_handledById_fkey` FOREIGN KEY (`handledById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
