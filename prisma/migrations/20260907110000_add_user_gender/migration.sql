-- 用户资料性别设置：预置选项使用 enum，自定义文本单独保存。
-- 本迁移只准备数据库变更；本轮不执行生产 migration。
ALTER TABLE `User`
  ADD COLUMN `gender` ENUM('MALE', 'FEMALE', 'CUSTOM') NULL,
  ADD COLUMN `customGender` VARCHAR(20) NULL;
