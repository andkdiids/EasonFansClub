-- Separate user feedback from administrator review reminders.
-- Keep every historical Notification enum value so this incremental change
-- remains compatible with databases that already applied later enum additions.
ALTER TABLE `Notification`
  MODIFY COLUMN `type` ENUM(
    'REPLY',
    'LIKE',
    'SYSTEM',
    'MESSAGE',
    'ACTIVITY',
    'ADMIN',
    'FOLLOW',
    'BADGE',
    'FRIEND_REQUEST',
    'BIRTHDAY_GREETING',
    'GUESS_SONG_DUEL_INVITE',
    'USER_REWARD',
    'FRIEND_BIRTHDAY',
    'FEEDBACK',
    'REVIEW'
  ) NOT NULL;
