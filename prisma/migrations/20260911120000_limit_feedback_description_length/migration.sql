-- Keep the 2,000-character feedback limit above the database storage type.
-- FeedbackReply stores the initial feedback text as well, so both columns
-- must be widened together to avoid a database error on long valid feedback.
ALTER TABLE `Feedback`
    MODIFY COLUMN `content` TEXT NOT NULL;

ALTER TABLE `FeedbackReply`
    MODIFY COLUMN `content` TEXT NOT NULL;
