-- Extend the legacy play-record table for EasMusic online/local listening
-- telemetry. Existing rows remain online records tied to MusicTrack.
ALTER TABLE `MusicPlayRecord`
    MODIFY `trackId` VARCHAR(191) NULL,
    ADD COLUMN `source` ENUM('ONLINE', 'LOCAL') NOT NULL DEFAULT 'ONLINE',
    ADD COLUMN `eventId` VARCHAR(191) NULL,
    ADD COLUMN `startedAt` DATETIME(3) NULL,
    ADD COLUMN `endedAt` DATETIME(3) NULL,
    ADD UNIQUE INDEX `MusicPlayRecord_userId_eventId_key` (`userId`, `eventId`),
    ADD INDEX `MusicPlayRecord_userId_source_playedAt_idx` (`userId`, `source`, `playedAt`),
    ADD INDEX `MusicPlayRecord_userId_startedAt_endedAt_idx` (`userId`, `startedAt`, `endedAt`);
