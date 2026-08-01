-- Add the explicit concert archive category. Existing rows safely inherit MAIN.
ALTER TABLE `MusicTour`
  ADD COLUMN `category` ENUM('MAIN', 'SMALL', 'GUEST') NOT NULL DEFAULT 'MAIN';
