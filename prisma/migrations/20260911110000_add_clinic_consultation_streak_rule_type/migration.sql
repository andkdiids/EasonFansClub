-- Extend BadgeRule.ruleType for the aspirin clinic consultation streak rule.
-- This is schema-only: it intentionally performs no business-data writes.
ALTER TABLE `BadgeRule`
    MODIFY `ruleType` ENUM(
        'POST_COUNT',
        'FEATURED_POST_COUNT',
        'CHECKIN_TOTAL_DAYS',
        'CHECKIN_STREAK',
        'ACCOUNT_AGE_DAYS',
        'FRIEND_COUNT',
        'FOLLOWER_COUNT',
        'GUESS_SONG_MAX_STREAK',
        'DUEL_WIN_COUNT',
        'WANT_LISTEN_MAX_STREAK',
        'CONCERT_ATTENDANCE_COUNT',
        'CONCERT_SHOW_ATTENDED',
        'CONCERT_TOUR_ATTENDED',
        'RATING_COUNT',
        'BADGE_SERIES_COMPLETE',
        'ACTIVITY_PARTICIPATION',
        'BIRTHDAY_ZODIAC',
        'BIRTHDAY_TODAY',
        'BADGE_OWNERSHIP',
        'CLINIC_CONSULTATION_STREAK'
    ) NOT NULL;
