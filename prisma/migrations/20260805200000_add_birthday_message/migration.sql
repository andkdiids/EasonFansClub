-- 生日祝福文案池：管理员维护生日纪念通知文案，发送时随机选择一条启用文案。
-- 注意：本迁移不会自动在生产库执行；部署时请运行 `prisma migrate deploy`。

CREATE TABLE `BirthdayMessage` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL DEFAULT '🎂 生日纪念',
  `content` TEXT NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `BirthdayMessage_isActive_idx`(`isActive`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
