CREATE INDEX "Post_board_feed_idx" ON "Post"("boardId", "status", "isDeleted", "isPinned", "isFeatured", "createdAt");
CREATE INDEX "Post_global_feed_idx" ON "Post"("status", "isDeleted", "isPinned", "isFeatured", "createdAt");
CREATE INDEX "Post_hot_feed_idx" ON "Post"("status", "isDeleted", "isPinned", "isFeatured", "likeCount", "replyCount");

CREATE INDEX "DailyMessage_latest_idx" ON "DailyMessage"("date", "isDeleted", "isPinned", "isFeatured", "createdAt");
CREATE INDEX "DailyMessage_hot_idx" ON "DailyMessage"("date", "isDeleted", "isPinned", "isFeatured", "likeCount", "commentCount", "createdAt");

CREATE INDEX "Activity_status_createdAt_idx" ON "Activity"("status", "createdAt");
CREATE INDEX "MusicTrack_visible_sort_createdAt_idx" ON "MusicTrack"("isVisible", "sortOrder", "createdAt");
