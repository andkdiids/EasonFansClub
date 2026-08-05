-- 生日系统：仅存储生日月份与日期，不存储出生年份，以保护用户隐私。
-- 生日只用于「生日纪念」徽章与「今日生日人数」统计，不会公开展示具体日期。
ALTER TABLE `User`
  ADD COLUMN `birthMonth`   INT NULL,
  ADD COLUMN `birthDay`     INT NULL,
  ADD COLUMN `birthdaySetAt` DATETIME NULL;

CREATE INDEX `User_birthMonth_birthDay_idx` ON `User` (`birthMonth`, `birthDay`);
