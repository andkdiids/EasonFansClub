# 顺大师 V4.2 开发清单

| 任务 | 状态 | 恢复线索 |
| --- | --- | --- |
| 账务 Schema 和增量迁移 | IMPLEMENTED | 2fdf722f，真实 MySQL 验证待办 |
| 服务端奖池和概率规则 | VERIFIED | 22b516b5，新增定向测试 4 项通过 |
| 库存事务、流水和库存对账 | IMPLEMENTED | lib/shun-item-inventory.ts，真实并发和回滚待验证 |
| 每日主线奖励 | IMPLEMENTED | 从已提交任务事实投递，复用原主线判定，独立日额度 |
| 每周 3/5/7 天奖励 | IMPLEMENTED | 独立档位发放记录，过滤启用前日期，真实重试待验证 |
| 五类社区掉落及防刷 | IMPLEMENTED | 真实任务及通讯录帖子分享，已保存抽取值、日额度和去重；历史事件边界待验证 |
| 顺手牵羊 | IMPLEMENTED | 服务端使用与顺取结算已接通，百宝箱入口和真实测试待办 |
| 天使的礼物 | IMPLEMENTED | 服务端随机匹配、独立抽道具、双方流水与额度，拒绝指定接收者；真实并发待验证 |
| 十面埋伏 | IMPLEMENTED | 服务端候选持久化和模式切换，通知、使用入口和真实测试待办 |
| 最佳损友 | IMPLEMENTED | 反击 API、挂号费结算、历史记录入口和目标上限；真实账务待验证 |
| 任我顺 | IMPLEMENTED | 定向顺取服务与 API，好友选择界面及真实测试待办 |
| 碌卡 | IMPLEMENTED | 待生效、原金额概率、同事务消费，界面与真实测试待办 |
| 时光倒流 | IMPLEMENTED | 服务端二次追回及补偿，历史记录投影和真实测试待办 |
| 道具 API | IN_PROGRESS | items、item-drop、extra-attempt、gift、pending-item、定向 attempt、retry-item 与 revenge-item 已接入鉴权路由 |
| 百宝箱、图鉴、七个 SVG | IMPLEMENTED | 已连接真实库存、流水及红点，浏览器验收待办 |
| 好友选择和赠送交互 | IMPLEMENTED | 任我顺使用现有通讯录 API，赠送由服务端随机匹配，浏览器验收待办 |
| Toast 和站内通知 | IMPLEMENTED | 活跃掉落短提示、奖励通知、匿名效果通知及道具箱定位，浏览器验收待办 |
| 首页及历史记录联动 | IMPLEMENTED | 真实道具结果显示在历史卡片中，既有回归通过 |
| 后台配置、统计和审计 | IMPLEMENTED | 管理员路由、版本与审计、配置编辑和统计查询，真实验收待办 |
| 服务端功能开关 | IMPLEMENTED | SHUN_ITEMS_ENABLED 默认关闭，道具配置版本也必须启用 |
| 全仓检查及构建 | BLOCKED | 当前工作树无完整依赖；Corepack 下载遇到 DNS ENOTFOUND |
| 全量回归及安全测试 | TODO | 定向套件 75 项通过，其中原基线 46 项、道具新增 6 项；隔离集成测试已新增且待运行 |
| 空库和升级迁移验证 | BLOCKED | Docker 引擎不可用；本地 MySQL 8.4.11 二进制已找到，沙箱内初始化出现 InnoDB I/O 错误 |
| 真实 MySQL 并发和账务 | BLOCKED | 已编写库存、并发随机赠送、额外次数与对账测试；剩余业务账务场景待扩展 |
| PC、常规 H5、小屏 H5 | TODO | 待真实业务接通和隔离测试环境 |
