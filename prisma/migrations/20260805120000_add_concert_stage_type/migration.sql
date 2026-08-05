-- Add explicit concert stage type so encore / final stations are no longer
-- encoded inside the city string. Existing rows keep NORMAL (their type is
-- still derived from the legacy "城市（标签）" city label at read time).
ALTER TABLE `MusicConcert`
  ADD COLUMN `stageType` ENUM('NORMAL', 'ENCORE', 'FINAL') NOT NULL DEFAULT 'NORMAL';
