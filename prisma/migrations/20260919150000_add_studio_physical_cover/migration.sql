-- A physical cover is optional project metadata. It is intentionally kept
-- separate from the bead grid JSON so cover changes never affect editing
-- history, counts, dimensions, or exports of the pattern itself.
ALTER TABLE `StudioProject`
  ADD COLUMN `physicalCoverImage` TEXT NULL;
