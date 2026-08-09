-- Rename the existing daily-chat board for display only. The slug, id and
-- all existing post relations remain unchanged.
UPDATE `Board`
SET `name` = '日常吹水', `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `slug` = 'daily-chat';
