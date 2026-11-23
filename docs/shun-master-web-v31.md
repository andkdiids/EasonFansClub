# 顺大师 Web V3.1 开发验收

基线为 `4368052e25ef020a0c2c048767c25878eb4c2bd0`。功能开关的迁移初始值为关闭。

## 功能入口

- `/shun-master` 支持加入、退出、顺取、分页记录、黄金倒计时和抓捕。消息链接定位对应记录。
- 顶栏、移动端 E院中心和 `/games` 均进入同一个页面。
- `/admin/shun-master` 使用现有 `site_config_manage` 权限，提供规则修改、流水、金额分布、准备金、补偿和审计查询。
- 双手图标为单色 SVG。支持浅色和深色背景的独立文件位于 `public/shun-master`。

## 接口

| 方法 | 接口 |
| --- | --- |
| GET | `/api/shun-master/status`、`/api/shun-master/config` |
| GET | `/api/shun-master/records?side=in\|out&cursor=...&record=...` |
| POST | `/api/shun-master/membership`、`/api/shun-master/attempt` |
| POST | `/api/shun-master/capture/:id/start`、`/api/shun-master/capture/:id/guess` |
| GET / PATCH | `/api/admin/shun-master` |

用户接口只返回公开规则和本人的记录。抓捕候选返回公开昵称、头像和 UID，正确答案没有标记。被顺通知不写入顺取者信息。金额和匹配权重不进入用户接口。

## 数据与结算

新增迁移 `20261123133000_add_shun_master`。三个新表维护规则与准备金、主动参与状态和顺取／抓捕记录。挂号费继续由 `User.points`、`PointLog` 及现有扣费与发放函数结算。顺取、追回和补偿流水使用唯一业务键，追回流水指向对应原始流水。

写入事务先锁定规则和准备金记录，再按用户 ID 顺序锁定相关余额。每日限额按北京时间计算。同一顺取者的请求标识和每日目标均有唯一索引。顺取、双方流水和通知同事务提交。抓捕同样在事务内校验，仅被顺者可提交一次，模式切换由冻结的黄金截止时间决定。

每天可累计一次活跃日标记，数据来自最近七个北京时间日期内的有效挂号、最近登录和最近访问。注册满七天、已验证联系方式、有效资料和主动加入是参与条件。互相拉黑的账号及共用已验证联系方式的账号不参与匹配。调整被顺上限要求重新确认。接口沿用站内鉴权、来源校验和用户／IP 限流。

按指定 `25/21/17/14/10/7/6` 概率表，余额充足时的期望为单次 **3.08**、七次 **21.56**。默认补偿预算为 1,000，管理员可调整。可抓捕记录预留全额，抓捕完成后释放未用准备金。预算不足暂停新顺取，已有记录仍可结算。补偿使用独立流水和审计附注。

## 上线前需关注

- 全局写入锁保护跨用户的每日限额和预算。真实参与规模下需要评估峰值吞吐和锁等待。
- 抓捕资格没有过期时间。长期不抓捕的记录持续占用准备金。候选账号注销或停用导致身份不可展示时，保留固定名单和准备金，并返回不可抓捕。
- 当前关联识别覆盖明确的账号关联信号和请求频率。使用完全不同联系方式的协同账号仍需要运营监控。
- 增量迁移扩展现有 `PointLog.action` 枚举。生产操作前应评估该表的 DDL 锁等待。
- 本地验证与生产验收独立。生产合并、数据库迁移和发布需要明确授权。

## 改动范围和复验入口

| 模块 | 改动文件 |
| --- | --- |
| 会员、抓捕与结算 | `lib/shun-master.ts`、`lib/shun-master-rules.ts`、`lib/registration-fee.ts` |
| 页面和视觉 | `app/shun-master/`、`components/ShunMasterArt.tsx`、`components/ShunMasterLogo.tsx`、`public/shun-master/` |
| 导航和后台 | `components/layout/Topbar.tsx`、`components/layout/MobileNavigation.tsx`、`components/games/GameCenter.tsx`、`lib/navigation-registry.ts`、`lib/admin-navigation.ts`、`lib/admin-permission-config.ts`、`app/admin/shun-master/` |
| HTTP | `app/api/shun-master/`、`app/api/admin/shun-master/` |
| 数据库和测试 | `prisma/schema.prisma`、`prisma/migrations/20261123133000_add_shun_master/`、`tests/shun-master-*.test.ts`、`tests/topic-activity-hotfix-v4.test.ts` |

规则单测可直接运行。数据库验收使用 `SHUN_MASTER_MYSQL_QA=1`，要求在 `127.0.0.1:33326/ecfc_shun_qa` 使用空白的合成数据库，并在已有主分支 Schema 基线上执行本次迁移。真实 HTTP 和浏览器验收使用 `SHUN_MASTER_BROWSER_QA=1`，需要从同一隔离数据库以 `127.0.0.1:3126` 启动 Web，并让测试进程使用与本地 Web 一致的测试 JWT 密钥。两项验收默认跳过，脚本会校验隔离数据库地址。

## 验收结果

- Prisma 校验、客户端生成、MySQL 迁移静态检查、TypeScript、ESLint、Next.js 生产构建通过。全仓 ESLint 有警告，零错误。
- 隔离 MySQL 验证了默认关闭、每日限额、固定候选、跨期拒绝、同时抓捕幂等、原额追回、补偿审计、余额截断和事务回滚。
- 真实 HTTP 与 Edge 验证了角色权限、PC 和移动入口、顺取动画、匿名记录、黄金抓捕、后台高频请求拦截审计，以及 320／390／430px 和深色主题。
- 全仓复跑 4,707 项通过、30 项默认跳过。唯一失败是 Windows CRLF 检出的历史迁移文件和预期 LF 字节不同。同一用例使用 Git 原始字节单独通过，历史迁移保持原样。
