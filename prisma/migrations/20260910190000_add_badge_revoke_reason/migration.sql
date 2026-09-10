-- Preserve the reason a badge ownership/source was revoked so incident
-- cleanups can be re-evaluated without treating every REVOKED row alike.
-- This migration only adds nullable columns and classifies the existing
-- incident marker written by the zodiac repair dry-run/apply script.

ALTER TABLE `UserBadge`
    ADD COLUMN `revokeReason` VARCHAR(64) NULL;

ALTER TABLE `UserBadgeSource`
    ADD COLUMN `revokeReason` VARCHAR(64) NULL;

UPDATE `UserBadgeSource`
SET `revokeReason` = 'INCIDENT_INVALID_ZODIAC_PERIOD_GRANT'
WHERE `grantReason` = 'INCIDENT_INVALID_ZODIAC_PERIOD_GRANT'
  AND `revokedAt` IS NOT NULL;

UPDATE `UserBadge` ub
INNER JOIN `UserBadgeSource` ubs ON ubs.`userBadgeId` = ub.`id`
SET ub.`revokeReason` = 'INCIDENT_INVALID_ZODIAC_PERIOD_GRANT'
WHERE ub.`status` = 'REVOKED'
  AND ubs.`revokeReason` = 'INCIDENT_INVALID_ZODIAC_PERIOD_GRANT';
