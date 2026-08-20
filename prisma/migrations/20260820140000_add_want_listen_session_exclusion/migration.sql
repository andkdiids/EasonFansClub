-- 想听排行榜：支持管理员精确删除单条用户成绩（保留游戏历史，仅排除排行榜聚合）
ALTER TABLE "WantListenSession" ADD COLUMN "excludedFromLeaderboard" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "WantListenSession_excludedFromLeaderboard_status_completedAt_idx"
ON "WantListenSession" ("excludedFromLeaderboard", "status", "completedAt");
