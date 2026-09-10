-- Split financial processing from notification delivery so a request timeout
-- cannot roll back points that were already awarded.
ALTER TABLE `GlobalPointsGrantBatch`
    ADD COLUMN `processedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pendingCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `processingCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `notificationSuccessCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `notificationFailedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

ALTER TABLE `GlobalPointsGrantRecipient`
    ADD COLUMN `pointsStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `notificationStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `notificationFailureReason` TEXT NULL,
    ADD COLUMN `pointsProcessedAt` DATETIME(3) NULL,
    ADD COLUMN `notificationProcessedAt` DATETIME(3) NULL,
    ADD COLUMN `processingToken` VARCHAR(64) NULL,
    ADD COLUMN `processingPhase` VARCHAR(20) NULL,
    ADD COLUMN `processingStartedAt` DATETIME(3) NULL;

-- Existing rows were processed by the old all-in-one transaction. Preserve
-- their point result and rebuild notification state from the existing unique
-- notification key; an old PROCESSING row is safe to resume from PENDING.
UPDATE `GlobalPointsGrantRecipient`
SET
    `pointsStatus` = CASE
        WHEN `status` = 'SUCCESS' THEN 'SUCCESS'
        WHEN `status` = 'FAILED' THEN 'FAILED'
        ELSE 'PENDING'
    END,
    `pointsProcessedAt` = CASE
        WHEN `status` IN ('SUCCESS', 'FAILED') THEN `processedAt`
        ELSE NULL
    END,
    `processingToken` = NULL,
    `processingPhase` = NULL,
    `processingStartedAt` = NULL;

UPDATE `GlobalPointsGrantRecipient` r
LEFT JOIN `Notification` n
    ON n.`recipientId` = r.`userId`
   AND n.`key` = CONCAT('global-points-grant:', r.`batchId`, ':', r.`userId`)
SET
    r.`notificationStatus` = CASE WHEN n.`id` IS NULL THEN 'PENDING' ELSE 'SUCCESS' END,
    r.`notificationProcessedAt` = CASE WHEN n.`id` IS NULL THEN NULL ELSE n.`createdAt` END
WHERE r.`pointsStatus` = 'SUCCESS';

UPDATE `GlobalPointsGrantBatch` b
LEFT JOIN (
    SELECT
        `batchId`,
        SUM(CASE WHEN `pointsStatus` = 'SUCCESS' THEN 1 ELSE 0 END) AS `successCount`,
        SUM(CASE WHEN `pointsStatus` = 'FAILED' THEN 1 ELSE 0 END) AS `failedCount`,
        SUM(CASE WHEN `pointsStatus` = 'PENDING' THEN 1 ELSE 0 END) AS `pendingCount`,
        SUM(CASE WHEN `pointsStatus` = 'PROCESSING' THEN 1 ELSE 0 END) AS `processingCount`,
        SUM(CASE WHEN `notificationStatus` = 'SUCCESS' THEN 1 ELSE 0 END) AS `notificationSuccessCount`,
        SUM(CASE WHEN `notificationStatus` = 'FAILED' THEN 1 ELSE 0 END) AS `notificationFailedCount`
    FROM `GlobalPointsGrantRecipient`
    GROUP BY `batchId`
) r ON r.`batchId` = b.`id`
SET
    b.`successCount` = COALESCE(r.`successCount`, 0),
    b.`failedCount` = COALESCE(r.`failedCount`, 0),
    b.`processedCount` = COALESCE(r.`successCount`, 0) + COALESCE(r.`failedCount`, 0),
    b.`pendingCount` = COALESCE(r.`pendingCount`, 0),
    b.`processingCount` = COALESCE(r.`processingCount`, 0),
    b.`notificationSuccessCount` = COALESCE(r.`notificationSuccessCount`, 0),
    b.`notificationFailedCount` = COALESCE(r.`notificationFailedCount`, 0),
    b.`status` = CASE
        WHEN COALESCE(r.`pendingCount`, 0) + COALESCE(r.`processingCount`, 0) > 0 THEN 'PROCESSING'
        WHEN COALESCE(r.`failedCount`, 0) = 0 THEN 'COMPLETED'
        WHEN COALESCE(r.`successCount`, 0) > 0 THEN 'PARTIAL_FAILED'
        ELSE 'FAILED'
    END,
    b.`completedAt` = CASE
        WHEN COALESCE(r.`pendingCount`, 0) + COALESCE(r.`processingCount`, 0) = 0
            THEN COALESCE(b.`completedAt`, CURRENT_TIMESTAMP(3))
        ELSE NULL
    END;

CREATE INDEX `GlobalPointsGrantRecipient_batchId_pointsStatus_id_idx`
    ON `GlobalPointsGrantRecipient`(`batchId`, `pointsStatus`, `id`);
CREATE INDEX `GlobalPointsGrantRecipient_batchId_notificationStatus_id_idx`
    ON `GlobalPointsGrantRecipient`(`batchId`, `notificationStatus`, `id`);
CREATE INDEX `GlobalPointsGrantRecipient_processing_claim_idx`
    ON `GlobalPointsGrantRecipient`(`processingPhase`, `processingStartedAt`);
