-- Enlarge SiteSetting.value from VARCHAR(191) to TEXT.
--
-- The registration control settings are persisted as SiteSetting rows. The close
-- notice (registration.control.closedMessage) is user-editable up to ~2000
-- characters, and the daily schedule (registration.control.dailySchedule) is
-- serialized JSON that grows with every window. Both routinely exceed the
-- previous VARCHAR(191) limit, so Prisma writes failed with P2000 (value too
-- long for column). TEXT comfortably holds long notices and JSON configs.
--
-- `value` carries no index, unique constraint, or foreign key, so MODIFY is safe
-- and preserves every existing row and value.
ALTER TABLE `SiteSetting`
MODIFY `value` TEXT NOT NULL;
