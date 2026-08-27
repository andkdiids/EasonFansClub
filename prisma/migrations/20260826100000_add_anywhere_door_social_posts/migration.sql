-- 随意门 Phase 3 数据层：只创建 schema 迁移文件，不在此处连接或修改生产数据库。
CREATE TABLE `SocialPost` (
  `id` VARCHAR(191) NOT NULL,
  `platform` ENUM('INSTAGRAM') NOT NULL DEFAULT 'INSTAGRAM',
  `externalId` VARCHAR(191) NOT NULL,
  `shortcode` VARCHAR(191) NULL,
  `authorUsername` VARCHAR(191) NOT NULL,
  `authorDisplayName` VARCHAR(191) NULL,
  `caption` TEXT NULL,
  `permalink` TEXT NULL,
  `publishedAt` DATETIME(3) NOT NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `mediaType` ENUM('IMAGE', 'VIDEO', 'CAROUSEL', 'REEL') NOT NULL,
  `status` ENUM('DISCOVERED', 'DOWNLOADING', 'READY', 'FAILED', 'HIDDEN', 'SOURCE_DELETED') NOT NULL DEFAULT 'DISCOVERED',
  `provider` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SocialPost_platform_externalId_key`(`platform`, `externalId`),
  INDEX `SocialPost_status_publishedAt_idx`(`status`, `publishedAt`),
  INDEX `SocialPost_authorUsername_publishedAt_idx`(`authorUsername`, `publishedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SocialPostMedia` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `type` ENUM('IMAGE', 'VIDEO') NOT NULL,
  `storageUrl` TEXT NOT NULL,
  `thumbnailUrl` TEXT NULL,
  `width` INTEGER NULL,
  `height` INTEGER NULL,
  `durationMs` INTEGER NULL,
  `sortOrder` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SocialPostMedia_postId_sortOrder_key`(`postId`, `sortOrder`),
  INDEX `SocialPostMedia_postId_sortOrder_idx`(`postId`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SocialPostLike` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SocialPostLike_userId_postId_key`(`userId`, `postId`),
  INDEX `SocialPostLike_postId_createdAt_idx`(`postId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SocialPostComment` (
  `id` VARCHAR(191) NOT NULL,
  `postId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  `parentId` VARCHAR(191) NULL,
  `content` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  INDEX `SocialPostComment_postId_parentId_createdAt_idx`(`postId`, `parentId`, `createdAt`),
  INDEX `SocialPostComment_authorId_createdAt_idx`(`authorId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SocialSyncLog` (
  `id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(64) NOT NULL,
  `actor` VARCHAR(191) NULL,
  `runId` VARCHAR(191) NULL,
  `datasetId` VARCHAR(191) NULL,
  `runStatus` VARCHAR(64) NULL,
  `runStartedAt` DATETIME(3) NULL,
  `runFinishedAt` DATETIME(3) NULL,
  `usageTotalUsd` DOUBLE NULL,
  `billableResults` INTEGER NULL,
  `target` VARCHAR(191) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL,
  `finishedAt` DATETIME(3) NULL,
  `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'RATE_LIMITED', 'CHALLENGE_REQUIRED') NOT NULL DEFAULT 'RUNNING',
  `foundCount` INTEGER NOT NULL DEFAULT 0,
  `createdCount` INTEGER NOT NULL DEFAULT 0,
  `updatedCount` INTEGER NOT NULL DEFAULT 0,
  `mediaCount` INTEGER NOT NULL DEFAULT 0,
  `durationMs` INTEGER NULL,
  `errorCode` VARCHAR(64) NULL,
  `errorMessage` TEXT NULL,
  INDEX `SocialSyncLog_target_startedAt_idx`(`target`, `startedAt`),
  INDEX `SocialSyncLog_status_startedAt_idx`(`status`, `startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SocialPostMedia`
  ADD CONSTRAINT `SocialPostMedia_postId_fkey`
  FOREIGN KEY (`postId`) REFERENCES `SocialPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SocialPostLike`
  ADD CONSTRAINT `SocialPostLike_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SocialPostLike_postId_fkey`
  FOREIGN KEY (`postId`) REFERENCES `SocialPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SocialPostComment`
  ADD CONSTRAINT `SocialPostComment_postId_fkey`
  FOREIGN KEY (`postId`) REFERENCES `SocialPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SocialPostComment_authorId_fkey`
  FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SocialPostComment_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `SocialPostComment`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
