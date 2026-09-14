-- Explicit opt-in for manual badge dispatch from a Salon post detail.
-- Existing badges remain unavailable to this shortcut until an administrator
-- enables the field in Badge management.
ALTER TABLE `Badge`
    ADD COLUMN `salonAssignable` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `Badge_salonAssignable_isEnabled_isActive_idx`
    ON `Badge`(`salonAssignable`, `isEnabled`, `isActive`);
