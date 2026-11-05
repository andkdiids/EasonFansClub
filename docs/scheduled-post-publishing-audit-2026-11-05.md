# 定时发布功能上线前审查

日期：2026-11-05
分支：`feature/scheduled-post-publishing`
审查基准提交：`7678cbec4570ad75b0179e8526bbbdd0c141924d`
对比基线：`origin/main` / merge-base `5a0e59d4a20c406324462e2c94ffe173649b40b2`

## 最终状态：BLOCKED

定时发布代码和新增日期权限的定向测试通过，但没有可确认安全的独立 MySQL 测试数据库，无法完成本审查要求的真实并发、故障恢复和迁移执行验收。全仓生产构建也被 main 基线已有类型错误阻断。未连接或写入生产数据库，未执行迁移、推送、合并或部署。

## 发现与处理

| 严重程度 | 发现 | 处理/状态 |
| --- | --- | --- |
| 高 | 用户编辑触发重新审核时，已取消或已完成的唯一发布 outbox 事件没有重置；拒绝后再编辑并审核通过，可能公开帖子但遗漏公开副作用。 | 已在编辑事务内将既有事件重新排队，并在同一 Post 行锁下拒绝普通用户编辑已取消的定时帖；详情页同步隐藏该编辑入口。 |
| 高 | 定时任务复用批次开始时刻计算后续事件租约，长批次会使新领取的事件看起来已超时，增加重复领取风险。 | 已使用每个事件实际领取时间，并增加串行租约续期及停止清理；增加回归断言。真实数据库并发效果仍待 MySQL 验收。 |
| 高 | 之前客户端可以自行决定日期权限时，普通用户可伪造次日预约。 | 已由服务端 `hasAdminPermission(user, 'post_manage')` 计算日期权限；前端权限来自服务端页面，不读取请求体角色。API 写入事务前再次按服务器时间校验日期与提前量。 |
| 中 | 任务每轮最多串行处理 100 个到期帖子及 100 个副作用事件，而 cron 客户端超时为 50 秒；大积压可能导致请求超时和任务实例重叠，增加数据库压力。 | 代码使用条件更新、行锁和事件锁控制重复处理，但未用生产等效负载测出安全批量/时限。需在独立 MySQL 压测后决定是否调整。 |
| 阻塞 | 没有可用的独立 MySQL 测试目标。 | 真实并发与迁移执行验收未运行；不能用 Mock 或静态测试代替。 |
| 阻塞 | Next.js 构建类型检查失败。 | 错误是 main 基线已有的 `HeroBackground.tsx:158` 类型错误；全仓类型诊断与 main 基线同为 123 项，定时发布改动文件没有新增诊断。 |

## 日期权限

- 普通用户只可选北京时间当天；预约次日或更晚由服务端返回 403 `SCHEDULE_NEXT_DAY_FORBIDDEN`。
- 拥有服务端 `post_manage` 权限的用户可预约当天或次日；第三天及以后返回明确业务错误。
- 所有预约均须满足当前服务器时间加 30 分钟。日期先按 `Asia/Shanghai` 自然日校验，再按 UTC instant 校验提前量。
- 日期选择器 `min`、`max` 由共享时区工具生成，每 15 秒刷新，以便北京时间午夜后重新计算；无剩余可用时间时显示提示并禁用选择器。
- 所有时间继续转换为 UTC ISO 时间提交和保存。DST 间隙与重复时刻的解析测试保留。

## 数据库与并发验收

- Migration SQL 已审查：新增 `publicationStatus` 默认 `PUBLISHED`、计划发布时间字段和发布 outbox；`publishedAt` 允许为空；唯一 `postId` 防止同帖创建多个事件；没有历史帖子 UPDATE 回填语句。
- `prisma validate` 通过（使用不连接数据库的本地占位 URL）；这不是 migration 执行结果。
- 本机没有配置 `DATABASE_URL` / 独立测试 URL，没有可用 MySQL 服务；Docker API 也不可用。因此 migration 实际执行、迁移前后历史可见性、并发领取、最多公开一次、事务崩溃恢复、连接中断/超时重试、审核与取消竞态、通知/奖励/索引副作用唯一性均为 **BLOCKED / NOT RUN**。
- 未查询或修改生产迁移 ledger，未执行生产迁移。上线前仍需先核对目标生产 ledger，再在独立 MySQL 完整跑迁移及并发套件。

## 定时任务与可见性

- 内部任务入口为 `POST /api/internal/daily-jobs/scheduled-post-publication`；要求 `DAILY_JOB_SECRET`，使用长度检查和 `timingSafeEqual`；缺密钥返回 503，无效密钥返回 403。
- `ops/cron/scheduled-post-publication.cron.example` 给出每分钟调用示例；脚本使用本机 API、连接超时 3 秒、总请求超时 50 秒，并将失败写 syslog。仓库样例不证明该 crontab 已安装到生产主机；本轮未检查或部署生产 cron。
- 失败事件采用指数重试（上限 60 分钟），连续三次向有 `post_manage` 的管理员发通知；失败及任务批次结果有结构化日志。syslog 告警规则只在样例注释中说明，实际告警接收端未验证。
- 常规公开查询共享条件要求 `status=PUBLISHED`、`publicationStatus=PUBLISHED`、`publishedAt != null` 及允许的审核状态；广场、搜索、个人主页、话题、推荐、分享、互动 API 和详情路由已做源码检查。作者/管理员的私有审核查看路径单独处理。未运行数据库驱动的接口集成测试。
- 审核拒绝/撤销、定时取消和发布任务使用 Post 行锁及条件更新；发布副作用以唯一 outbox 事件驱动，奖励、通知等使用既有幂等键。真实 MySQL 下的并发保证尚未验收。

## 检查结果

- 定时发布及发帖/审核/个人主页可见性回归：45/45 通过。包括当天/次日/第三日、23:29/23:30/23:31、午夜翻日、UTC 往返和 30 分钟边界。服务端权限来源与前端刷新行为由源码回归断言覆盖；不是实际 MySQL API 测试。E 盘 worktree 的 `tsx` 链接缺少 `esbuild`，本轮使用完整 C 盘 workspace 中的 `tsx` runner 执行这些测试。
- 改动文件 ESLint：0 errors，2 warnings；均为详情页原有 `<img>` 警告，与 main 基线位置相同。
- 全仓 TypeScript：123 项错误，与 main 基线相同；包括 `HeroBackground`、Framer Motion 类型及 Playwright 测试类型。定时发布和本次日期权限改动文件无新增错误。
- Next.js 生产构建：Webpack bundle 编译通过；随后 ESLint 报缺少依赖 `debug`，类型检查报 main 基线 `components/HeroBackground.tsx:158` 错误，退出码 1。
- `git diff --check`：通过。

## PR 条件

当前不满足本轮要求的上线前验收，不能标为 `READY_FOR_PR`。解除 `BLOCKED` 至少需要配置隔离 MySQL，执行真实并发/失败注入及 migration 前后历史数据验证，并修复或在合适的基线变更中清理现有构建阻塞项。生产 cron 的安装和告警接收也需要在正式发布步骤单独核实。
