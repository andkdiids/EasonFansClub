-- Add the ordered multi-badge equipment relation.
-- This migration is intentionally not executed in this change.

CREATE TABLE `UserEquippedBadge` (
  `id` VARCHAR(191) NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `equippedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `badgeId` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `UserEquippedBadge_userId_badgeId_key`(`userId`, `badgeId`),
  INDEX `UserEquippedBadge_userId_idx`(`userId`),
  INDEX `UserEquippedBadge_badgeId_idx`(`badgeId`),
  INDEX `UserEquippedBadge_userId_position_idx`(`userId`, `position`),
  PRIMARY KEY (`id`),
  CONSTRAINT `UserEquippedBadge_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UserEquippedBadge_badgeId_fkey`
    FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve legacy equipment only when the badge is still owned and currently
-- valid/wearable. Invalid or already-revoked legacy values are intentionally
-- not restored as equipped badges.
INSERT INTO `UserEquippedBadge` (
  `id`, `position`, `equippedAt`, `createdAt`, `updatedAt`, `userId`, `badgeId`
)
SELECT
  UUID(),
  0,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3),
  `u`.`id`,
  `u`.`equippedBadgeId`
FROM `User` `u`
INNER JOIN `Badge` `b` ON `b`.`id` = `u`.`equippedBadgeId`
WHERE `u`.`equippedBadgeId` IS NOT NULL
  AND `b`.`isEnabled` = 1
  AND `b`.`isActive` = 1
  AND `b`.`isWearable` = 1
  AND EXISTS (
    SELECT 1
    FROM `UserBadge` `ub`
    WHERE `ub`.`userId` = `u`.`id`
      AND `ub`.`badgeId` = `u`.`equippedBadgeId`
      AND `ub`.`status` = 'ACTIVE'
      AND (`ub`.`expiresAt` IS NULL OR `ub`.`expiresAt` > CURRENT_TIMESTAMP(3))
  );
