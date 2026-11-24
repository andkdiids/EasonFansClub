# 顺大师 Web V3.1 开发验收

V3.3 保留正常账号默认可交易的候选机制，普通用户端移除旧匹配保护入口与写接口。已有拒绝记录持续排除扣费目标，后台提供今日候选统计与历史动作审计。正式开放仍要求已发布公告和管理员确认。保护罩的价格、购买、时效和结算留待后续需求。

V3.2 延续 V3.1 账务规则，改用全站正常普通账号候选池。专属加入与规则确认不再是参与前提，历史记录保留。公开匹配需要已发布的全站顺大师公告与管理员明确确认，用户可随时打开匹配保护。增量迁移 `20261123153000_shun_master_public_pool` 迁移有证据的旧退出选择，不修改历史账务。网站未统一标记的普通测试账号须在开放前确认并开启保护。下文为 V3.1 原始验收记录。

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

每天可累计一次活跃日标记，数据来自最近七个北京时间日期内的有效挂号、最近登录和最近访问。正常登录账号在功能开启后可主动加入。互相拉黑的账号及共用已验证联系方式的账号不参与匹配。接口沿用站内鉴权、来源校验和用户／IP 限流。

增量迁移 `20261123143000_add_shun_master_consent` 按用户和版本记录同意时间。存在有效旧加入审计的用户复用版本 1，只有会员状态的用户需要确认。退出保留同意记录。管理员发布新的顺取次数、被顺上限、金额概率或黄金期时长会递增版本；布局和启停不改变版本。

按指定 `25/21/17/14/10/7/6` 概率表，余额充足时的期望为单次 **3.08**、七次 **21.56**。平台补偿总预算已取消，采用无限补偿预算模式：管理员不再填写预算，历史配置中的 `budget` 值只在读取时被忽略，不再限制新顺取。可抓捕记录仍预留全额，抓捕完成后释放未用准备金；准备金、累计平台补偿和当日补偿仅用于观察挂号费流转。补偿使用独立流水和审计附注。

## 上线前需关注

- 全局写入锁保护跨用户的每日限额和未结准备金统计。真实参与规模下需要评估峰值吞吐和锁等待。
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
| 匿名留言与神秘信件（增量） | `lib/shun-anonymous-letter.ts`、`app/api/shun-master/letter/[id]/route.ts`、`components/shun-master/AnonymousLetter.tsx`、`prisma/migrations/20261124173000_add_shun_master_anonymous_letter/`、`tests/shun-master-anonymous-letter.test.ts` |

规则单测可直接运行。数据库验收使用 `SHUN_MASTER_MYSQL_QA=1`，要求在 `127.0.0.1:33326/ecfc_shun_qa` 使用空白的合成数据库，并在已有主分支 Schema 基线上执行本次迁移。真实 HTTP 和浏览器验收使用 `SHUN_MASTER_BROWSER_QA=1`，需要从同一隔离数据库以 `127.0.0.1:3126` 启动 Web，并让测试进程使用与本地 Web 一致的测试 JWT 密钥。两项验收默认跳过，脚本会校验隔离数据库地址。

## 验收结果

- Prisma 校验、客户端生成、MySQL 迁移静态检查、TypeScript、ESLint、Next.js 生产构建通过。全仓 ESLint 有警告，零错误。
- 隔离 MySQL 验证了默认关闭、每日限额、固定候选、跨期拒绝、同时抓捕幂等、原额追回、补偿审计、余额截断和事务回滚。
- 真实 HTTP 与 Edge 验证了角色权限、PC 和移动入口、顺取动画、匿名记录、黄金抓捕、后台高频请求拦截审计，以及 320／390／430px 和深色主题。
- 全仓复跑 4,707 项通过、30 项默认跳过。唯一失败是 Windows CRLF 检出的历史迁移文件和预期 LF 字节不同。同一用例使用 Git 原始字节单独通过，历史迁移保持原样。

## 匿名留言与神秘信件（增量）

「顺一手」会先打开三选一窗口，而不是直接发起顺取：匿名留言 / 直接顺一手 / 关闭。结果弹窗里的「再顺一手」复用同一个窗口。

- 直接顺一手：调用原有 `shunAttempt(actorId, requestId)`，不带附加字段，行为与历史版本一致。
- 匿名留言：先写入 1–60 个字符（按码点计数、裁掉首尾空白、允许换行、纯空白不通过、走现有违禁词规则），随后在**同一个事务**内完成顺取与信件落库。
- 关闭或返回：不发起顺取、不消耗次数、不写入任何留言。

数据与安全：

- `ShunMasterAnonymousLetter.roundId` 唯一，一次顺取最多一封信；收件人恒为本次 `victimId`，发件人恒为本次 `actorId`。
- 同一 `requestId` 重放直接返回既有记录，即使重放携带不同正文也不会改写已创建的信件。
- 信件写入与顺取同事务，任一步失败整体回滚，不会出现「扣了挂号费却没留下信」或「留下信却没扣费」。
- `GET /api/shun-master/letter/[id]`（`id` 可以是信件 id 或顺取记录 id）只返回收件人可见字段：信件 id、记录 id、正文、创建时间、是否已读，以及抓捕状态所需的最少信息。`senderId`、昵称、头像、UID、邮箱、手机号一律不返回；无效 id、被隐藏的信件、非本人访问、记录不匹配统一 404，不可用于枚举发送者。

通知与自动开信：

- 有留言：标题「你收到一封神秘来信 ✉️」，链接 `/shun-master?record=<roundId>&side=in&letter=1`。
- 无留言：完全保留原有「挂号费被顺走啦！」通知与普通记录跳转，绝不弹信。
- 页面只有在 `letter` 标记与 `record` 同时存在时才请求信件；读取成功后立刻用 `history.replaceState` 移除标记，因此刷新、浏览器返回、React 重渲染都不会重放动画；读取失败静默降级为普通记录页，不出现空信封。

信件内「前往调查」：

- 复用 `POST /api/shun-master/capture/<roundId>/start`，也就是记录列表「抓捕追回」使用的同一接口，只打开抓捕选择，不提交答案。
- 已抓捕的记录按钮改为「查看调查结果」，展示既有结果；不可抓捕的记录说明原因并保留「收下这封信」。
- 黄金期 10 分钟、二选一/三选一、次数、追回、补偿与幂等全部沿用原实现。看信不会重置或延长黄金倒计时。

复验入口：

- 规则与契约：`npx tsx --test tests/shun-master-anonymous-letter.test.ts`
- 数据库：`SHUN_MASTER_MYSQL_QA=1` 运行 `tests/shun-master-mysql.test.ts`（隔离 `127.0.0.1:33326/ecfc_shun_qa`）

## 通知入口修复：点击通知真正开信（增量）

线上验收发现：匿名信通知使用 `SYSTEM` 类型，通知中心把 `type === 'SYSTEM'` 的个人通知一律交给通用系统通知弹窗，于是点击后只有「关闭」，没有信封动画、没有留言正文，也没有调查入口。

识别规则（`lib/shun-letter-notification.ts`，无 Prisma 依赖，可安全用于客户端）：

- 只认服务端写入的可信标识：key 前缀 `shun:` + 后缀 `:taken-letter`，或结构化链接 `/shun-master?record=<roundId>&letter=…`。
- 绝不按中文标题识别，也不猜测 roundId；两者都缺失时不产生任何跳转。
- 链接缺失但 key 存在时，用 key 里的 roundId 重建链接，因此 #159 之后已生成的历史通知同样可用。
- 普通顺大师通知（`shun:<id>:taken` / `:captured` / `:recover-actor`，或不带 `letter` 参数的记录链接）不匹配，行为完全不变。

入口改动：

- 通知中心：`isSystemNotification` 先排除匿名信；卡片目标以信件链接优先，智能入口显示「打开神秘来信」；点击卡片或智能入口都先落已读再跳转。
- 站内弹出层：若匿名信经 `/api/notifications/popup` 出现，CTA 改为「打开神秘来信」并直达信件，不会落到通用通知页（个人通知按设计不进 popup 队列，此处为防御性一致）。
- 记录页：被顺记录新增「查看神秘来信」，使用同一 `AnonymousLetter` 组件但以 `instant` 模式直接展示信纸，不重播飞入动画；已抓捕/不可抓捕/删除留言的语义不变。
- 信件组件：主按钮文案改为「立即调查」（已抓捕仍为「查看调查结果」）。

复验入口：

- 契约与源码级回归：`npx tsx --test tests/shun-letter-notification-entry.test.ts`
- 真实点击（隔离 MySQL + 真实 Next 服务 + Chrome）：`SHUN_LETTER_BROWSER_QA=1` 运行 `tests/shun-letter-notification-browser.test.ts`
