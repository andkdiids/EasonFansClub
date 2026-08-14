-- Persist Duel waiting-room and match heartbeat timestamps.
-- Presence is refreshed by room entry, ready/start actions and the WebSocket heartbeat.

ALTER TABLE `GuessSongDuelRoom`
  ADD COLUMN `hostLastSeenAt` DATETIME(3) NULL,
  ADD COLUMN `challengerLastSeenAt` DATETIME(3) NULL;

ALTER TABLE `GuessSongDuelPlayer`
  ADD COLUMN `lastSeenAt` DATETIME(3) NULL,
  ADD INDEX `GuessSongDuelPlayer_matchId_lastSeenAt_idx` (`matchId`, `lastSeenAt`);
