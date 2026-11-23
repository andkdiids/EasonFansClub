ALTER TABLE `ShunMasterSettings` ADD COLUMN `launchNoticeId` VARCHAR(191) NULL;

CREATE TABLE `ShunMasterProtection` (
    `userId` VARCHAR(191) NOT NULL,
    `protected` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`userId`),
    INDEX `ShunMasterProtection_protected_userId_idx`(`protected`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Only explicit withdrawals are protection evidence.
INSERT INTO `ShunMasterProtection` (`userId`, `protected`, `updatedAt`)
SELECT audit.userId, true, MAX(audit.occurredAt)
FROM `UserOperationLog` audit
WHERE audit.category = 'SHUN_MASTER' AND audit.action = 'LEAVE' AND audit.operatorType = 'USER'
  AND NOT EXISTS (
    SELECT 1 FROM `UserOperationLog` later
    WHERE later.userId = audit.userId AND later.category = 'SHUN_MASTER'
      AND later.action IN ('JOIN','REJOIN') AND later.occurredAt > audit.occurredAt
  )
GROUP BY audit.userId;
