# 活动开奖记录与公开中奖名单审计

**状态：BLOCKED**
**分支：** `feature/activity-draw-records-public-winners`
**基线：** `origin/main` `5a0e59d4a20c406324462e2c94ffe173649b40b2`
**范围：** 复用现有 `Activity`、`Lottery`、`LotteryPrize`、`LotteryEntry` 和奖励履约服务；未新建抽奖系统。

## 实现

- 抽奖仍由既有 `drawActivityLotteryInTransaction` 执行并写入 `LotteryEntry`。开奖算法、候选资格、报名截止、活动结束和中奖概率未改。
- `Lottery.id` 继续作为唯一开奖批次 ID，`LotteryEntry` 继续通过 `(lotteryId, userId)` 唯一约束避免同一批次重复中奖。开奖行锁、`DRAWN` 幂等返回和奖励失败后的原行重试逻辑未改。
- 新开奖在同一事务中保存 `drawSource`（`SCHEDULED` / `ADMIN_MANUAL`）。历史行保留 `NULL`，后台显示“历史未记录”，不猜测来源。
- 管理端在活动抽奖管理器加入“开奖记录”视图，显示活动/批次/奖品/用户 ID/昵称/头像/记录创建及中奖时间/中奖资格/奖励或兑奖状态/时间/失败原因；可按批次、奖品和用户筛选。数据由现有 `activity_manage` 保护的管理 API 读取，包含全部中奖行，不使用公开名单裁剪。
- 前台按奖品分组显示真实已保存中奖行。只在开奖状态、实际开奖时间和中奖人数齐全，且已保存记录数及奖品关联完整时公开；不完整批次隐藏名单并显示不可用状态。取消活动前已完成的批次仍可作为历史结果查看；未开奖取消批次不公开。
- 公开结果只序列化经现有公开昵称规则处理的昵称和公开头像，不返回用户 ID、E院 ID、电话、邮箱或真实姓名。个人中奖详情仍只返回给当前用户本人。
- 实物兑奖状态及虚拟奖励状态复用既有服务字段。勋章稳定键 `activity-lottery-winner:${winner.id}`、挂号费业务键 `activity-lottery-prize:${winner.id}` 和履约行锁逻辑没有改动。

## 数据库及历史数据

- 仅增加 `Lottery.drawSource String? @db.VarChar(32)` 和一条 MySQL migration：`ALTER TABLE Lottery ADD COLUMN drawSource VARCHAR(32) NULL`。没有默认来源、回填、覆盖、删除或额外索引；历史值保持未知。查询继续使用现有 `LotteryEntry` 批次/用户索引和唯一约束。
- Prisma schema 验证和客户端生成通过。migration-preflight 静态扫描报告 MySQL migration static check PASS；这不是实际数据库迁移验证。
- 本环境没有 `DATABASE_URL`、`MYSQL_TEST_DATABASE_URL`、`TEST_DATABASE_URL`、本地 `.env` 或 `mysql`/`mariadb` CLI。未连接数据库，未执行 migration，也未检查生产 migration ledger。
- 因而历史数据中 `LotteryEntry` 缺少用户/奖品关联、开奖时间或中奖人数的实际行数和范围未知。后台会将缺失时间、人数不一致或奖品关联缺失标记为不完整；不会重抽或补造。生产 ledger 与历史数据审计仍待安全数据库环境验证。

## 验证结果

- 针对性抽奖、取消、奖励、详情、migration allowlist 测试：**74 通过，0 失败**。
- 全仓测试（使用仅回环地址的占位 `DATABASE_URL`）：**4540 项，4505 通过，11 失败**。`migration-preflight.test.ts` 在占位 URL 下独立运行 **6/6 通过**；生产只读审计明确跳过。
- 全仓剩余失败位于未修改的其他功能/断言：`activity-registration-workflow` 海报比例断言、`friend-display-name`、`friend-remark-unification`、`guess-song-duel-transaction-retry`、`home-hero-cta`、`notification-no-badge-rendering`、`topic-activity-hotfix-v4` schema 基线断言、`topic-activity-post-participation`、`topic-activity-v3-platform`、`topic-v2-main-integration` 两项。未对这些项目逐一做 `main` 基线全量复跑，因此不将其认定为已证明的基线错误。
- `tsc --noEmit`：仍有 1 项错误，位于未修改的 `tests/android-rc11-publish-infrastructure.test.ts`：`../scripts/android-rc13-release.mjs` 缺少声明文件。
- 修改文件 ESLint：0 错误；`ActivityDetailView.tsx` 有 2 条 `<img>` 性能警告，图片标签是既有代码。Next.js 生产构建通过，静态页 123/123；Webpack 报 2 条循环 chunk 警告。
- `git diff --check` 通过。scheduled-post worktree 保持原有状态，未修改。

## 未解决项与 PR 判断

1. 需要在隔离的测试 MySQL 上执行这条 migration，并读取 migration ledger；当前没有安全测试数据库。
2. 需要在可授权只读的历史数据审计环境统计已结束活动的完整/不完整中奖记录范围。不能据现有代码推断线上历史数据实际完整度。
3. 全仓 TypeScript 尚有 1 项未改文件错误；全仓测试仍有 11 项失败。虽然本次针对性测试和生产构建通过，整仓验收尚未全绿。

**PR 条件：当前不具备。** 完成安全 MySQL migration/历史数据验证，并处理或明确接受全仓测试及 TypeScript 基线问题后再重新评估。没有推送、合并、生产迁移或部署。
