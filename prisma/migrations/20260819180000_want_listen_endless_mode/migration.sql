-- 想听三模式改为无尽模式（参考听听 ENDLESS）：
--   WantListenSession.questionCount 改为可空（null=无尽），新增连击/生命/已答题数
--   WantListenLeaderboardEntry 新增 maxStreak / totalQuestions，历史 20 题成绩回填
-- 本迁移只建文件，不自动应用到生产库。

ALTER TABLE `WantListenSession`
  MODIFY COLUMN `questionCount` INT NULL,
  ADD COLUMN `totalQuestions` INT NOT NULL DEFAULT 0,
  ADD COLUMN `currentStreak` INT NOT NULL DEFAULT 0,
  ADD COLUMN `maxStreak` INT NOT NULL DEFAULT 0,
  ADD COLUMN `wrongCount` INT NOT NULL DEFAULT 0,
  ADD COLUMN `livesRemaining` INT NOT NULL DEFAULT 3;

ALTER TABLE `WantListenLeaderboardEntry`
  ADD COLUMN `maxStreak` INT NOT NULL DEFAULT 0,
  ADD COLUMN `totalQuestions` INT NOT NULL DEFAULT 0;

-- 历史固定 20 题成绩：totalQuestions 回填 20（不删除历史数据）
UPDATE `WantListenLeaderboardEntry` SET `totalQuestions` = 20 WHERE `totalQuestions` = 0;

-- 无尽排行榜排序索引：score desc → correctCount desc → maxStreak desc → completionTimeMs asc
CREATE INDEX `WantListenLeaderboard_endless_sort_idx`
  ON `WantListenLeaderboardEntry` (`mode`, `periodType`, `periodKey`, `score`, `correctCount`, `maxStreak`, `completionTimeMs`);
