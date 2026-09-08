-- 用户主动选择“保密”是独立的有效性别状态；历史 NULL 仍表示从未设置。
-- 本迁移只准备数据库变更；本轮不执行生产 migration。
ALTER TABLE `User`
  MODIFY COLUMN `gender` ENUM('MALE', 'FEMALE', 'CUSTOM', 'PRIVATE') NULL;
