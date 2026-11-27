# 顺大师 V4.2 开发清单

| 任务 | 状态 | 恢复线索 |
| --- | --- | --- |
| 账务 Schema 和增量迁移 | IMPLEMENTED | 2fdf722f，真实 MySQL 验证待办 |
| 服务端奖池和概率规则 | VERIFIED | 22b516b5，新增定向测试 4 项通过 |
| 库存事务、流水和库存对账 | IMPLEMENTED | lib/shun-item-inventory.ts，真实并发和回滚待验证 |
| 每日主线奖励 | TODO | 接入 lib/growth-tasks 的服务端达成判定 |
| 每周 3/5/7 天奖励 | TODO | 独立发放记录及启用边界 |
| 五类社区掉落及防刷 | TODO | 真实成功事件、去重、额度及可重试投递 |
| 顺手牵羊 | IMPLEMENTED | 服务端使用与顺取结算已接通，百宝箱入口和真实测试待办 |
| 天使的礼物 | IMPLEMENTED | 服务端好友赠送、双方流水与额度，配置界面和真实测试待办 |
| 十面埋伏 | IMPLEMENTED | 服务端候选持久化和模式切换，通知、使用入口和真实测试待办 |
| 最佳损友 | TODO | 反击账务和目标次数上限 |
| 任我顺 | IMPLEMENTED | 定向顺取服务与 API，好友选择界面及真实测试待办 |
| 碌卡 | IMPLEMENTED | 待生效、原金额概率、同事务消费，界面与真实测试待办 |
| 时光倒流 | IMPLEMENTED | 服务端二次追回及补偿，历史记录投影和真实测试待办 |
| 道具 API | IN_PROGRESS | items、extra-attempt、gift 已接入鉴权路由 |
| 百宝箱、图鉴、七个 SVG | TODO | 真库存及流水 |
| 好友选择和赠送交互 | TODO | 复用通讯录 |
| Toast 和站内通知 | TODO | 真实奖励及记录定位 |
| 首页及历史记录联动 | TODO | 保留第一阶段交互 |
| 后台配置、统计和审计 | TODO | 版本记录、权限和奖池校验 |
| 服务端功能开关 | IMPLEMENTED | SHUN_ITEMS_ENABLED 默认关闭，道具配置版本也必须启用 |
| 全仓检查及构建 | BLOCKED | 当前工作树无完整依赖；Corepack 下载遇到 DNS ENOTFOUND |
| 全量回归及安全测试 | TODO | 原基线 46 项及奖池 4 项已跑通过，新增业务验收待实现 |
| 空库和升级迁移验证 | BLOCKED | Docker 两个本地引擎管道均不可用，尚无隔离 MySQL |
| 真实 MySQL 并发和账务 | BLOCKED | 尚无隔离 MySQL，测试用例仍待实现 |
| PC、常规 H5、小屏 H5 | TODO | 待真实业务接通和隔离测试环境 |
