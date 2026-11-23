ALTER TABLE `ShunMasterSettings` ADD COLUMN `rulesVersion` INTEGER NOT NULL DEFAULT 1;

CREATE TABLE `ShunMasterConsent` (
    `userId` VARCHAR(191) NOT NULL,
    `rulesVersion` INTEGER NOT NULL,
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`userId`, `rulesVersion`),
    INDEX `ShunMasterConsent_rulesVersion_idx`(`rulesVersion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Membership alone is not proof of acceptance. Restore only explicit opt-ins
-- that did not precede a later change to material terms.
INSERT INTO `ShunMasterConsent` (`userId`, `rulesVersion`, `acceptedAt`)
SELECT audit.userId, 1, MIN(audit.occurredAt)
FROM `UserOperationLog` audit
JOIN `ShunMasterMember` member ON member.userId = audit.userId
JOIN `ShunMasterSettings` settings ON settings.id = 1
WHERE audit.category = 'SHUN_MASTER' AND audit.action = 'JOIN'
  AND audit.operatorType = 'USER' AND audit.source = 'WEB'
  AND JSON_EXTRACT(audit.metadata, '$.victimCap') = JSON_EXTRACT(settings.config, '$.victimCap')
  AND JSON_EXTRACT(audit.metadata, '$.maxAmount') = 7
  AND NOT EXISTS (
    SELECT 1 FROM `UserOperationLog` changed
    WHERE changed.category = 'SHUN_MASTER' AND changed.action = 'CONFIG_UPDATE'
      AND changed.occurredAt >= audit.occurredAt
      AND (
        NOT (JSON_EXTRACT(changed.metadata, '$.old.attempts') <=> JSON_EXTRACT(changed.metadata, '$.config.attempts'))
        OR NOT (JSON_EXTRACT(changed.metadata, '$.old.victimCap') <=> JSON_EXTRACT(changed.metadata, '$.config.victimCap'))
        OR NOT (JSON_EXTRACT(changed.metadata, '$.old.goldenMinutes') <=> JSON_EXTRACT(changed.metadata, '$.config.goldenMinutes'))
        OR NOT (JSON_EXTRACT(changed.metadata, '$.old.probabilities') <=> JSON_EXTRACT(changed.metadata, '$.config.probabilities'))
      )
  )
GROUP BY audit.userId;
