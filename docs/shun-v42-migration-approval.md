# 顺大师 V4.2 历史迁移例外审批材料

审批状态 PENDING。原始历史回放状态 FAIL。

历史截止点 20260727220000 的 21 条迁移源于 PostgreSQL，首条使用双引号表标识符的 SQL 在 MySQL 返回 P3018 / 1064。当前 schema provider 和 migration lock 均为 mysql。原始历史文件保留。

隔离初始化入口 scripts/bootstrap-shun-items-qa.ts 以 ed804daa 的 MySQL Prisma 数据模型生成空库 DDL，再执行顺大师设置初始化和以下三条原样增量。此入口不写生产迁移账本。历史成功和失败抓捕数据在隔离升级验证中保留，证据 gift-intent-upgrade.log。

生产发布前须只读核对实际 schema、前置表主键及外键、三条文件校验值、_prisma_migrations 的成功/失败/回滚状态和未完成迁移。发布顺序按下列顺序执行，先完成前置兼容性核查再部署对应应用。

保留既有备份及迁移失败保护流程。MySQL DDL 隐式提交，失败后记录已执行语句及实际结构，停止后续迁移，由发布负责人判断补齐或恢复。不得以重写历史文件或伪造账本修复失败。

申请例外仅限原始 PostgreSQL 迁移无法在 MySQL 直接回放这一历史风险。技术矩阵仍须独立完成。批准该例外不代表允许本轮生产迁移、合并或部署。

- 20261127040000_add_shun_item_accounting SHA256 e2266cd5e42f4ffdc2ec5f39fe05cb800f89666fc98ed066ef08e1fec894208b
- 20261127050000_add_shun_reward_event_receipts SHA256 02de238621a5632846cba81a38e2dc4f51871b96a0becb7905f4446d8549ada7
- 20261127060000_add_shun_gift_intents SHA256 a432005177bc460446f33fa09fea5886a8f36a727ea84dcd78b08056e79346d9
