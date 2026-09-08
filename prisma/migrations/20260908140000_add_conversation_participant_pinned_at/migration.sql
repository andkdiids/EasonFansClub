-- Pin state belongs to one user's conversation membership, not the shared friendship.
-- This migration is intentionally created but not executed in this task.
ALTER TABLE `ConversationParticipant`
  ADD COLUMN `pinnedAt` DATETIME(3) NULL;
