CREATE TABLE `CantoneseLessonProgress` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `lessonId` VARCHAR(32) NOT NULL,
  `startedAt` DATETIME(3) NULL,
  `teachingCompletedAt` DATETIME(3) NULL,
  `questionsCompletedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CantoneseLessonProgress_userId_lessonId_key` (`userId`, `lessonId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `CantoneseLessonProgress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
