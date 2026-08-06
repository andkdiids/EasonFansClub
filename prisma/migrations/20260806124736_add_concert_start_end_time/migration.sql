-- 为 MusicConcert 增加开始时间 / 结束时间，支持「同一天多场」与场次时间展示。
-- 兼容旧数据：旧场次时间为空（NULL），不影响既有展示与排序。

ALTER TABLE `MusicConcert` ADD COLUMN `startTime` DATETIME(3) NULL, ADD COLUMN `endTime` DATETIME(3) NULL;
