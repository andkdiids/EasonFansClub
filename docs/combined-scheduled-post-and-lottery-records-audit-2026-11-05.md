# ECFC 定时发布与活动开奖记录统一整合审计

日期：2026-11-05

## 最终状态：BLOCKED

统一集成分支已在最新 main 基础上完成本地整合、分支独有回归修复和构建。两个原始工作树及分支均保留，未推送、未创建 PR、未合并 main、未连接或修改生产数据库、未部署。

不能进入 PR / 生产发布门禁的主要原因是没有安全可用的独立 MySQL 环境，因而无法执行两项迁移、真实并发/故障恢复测试或核验历史开奖记录完整性。完整仓库还有 11 项与 main 相同的测试失败，以及既有 TypeScript、全仓 ESLint 基线错误。

## 分支与来源

- 最新 main：ef7bf113709c95b9724c5f375fdc2c8beddd8ab2。
- 统一分支：feature/combined-scheduled-post-and-lottery-records。
- 本地整合合并提交：28a67a8e4e44d0861de91eb98373a1fd78ecf4b4，合并定时发布原始提交 7678cbec4570ad75b0179e8526bbbdd0c141924d。
- 后续活动开奖记录、整合修复、测试和本审计报告均在统一分支本地提交；未推送。当前最终提交号以该分支 HEAD 为准。
- 原始分支 feature/scheduled-post-publishing 和 feature/activity-draw-records-public-winners 及其工作树均保持原状。未删除、覆盖、stash 或清理其中任何修改。

## 整合与数据模型

- 两项功能没有服务表冲突。Prisma schema 的交叉修改分别作用于 Post 和 Lottery；各自的状态、事件与幂等键仍分开。
- Migration 顺序按 Prisma 名称排序：20261105090000_add_activity_lottery_draw_source，随后 20261105120000_add_scheduled_post_publication。
- 活动功能复用 Activity、Lottery、LotteryPrize、LotteryEntry 和现有履约服务。仅新增可空 Lottery.drawSource；Lottery.id 继续作为开奖批次，LotteryEntry 仍使用既有中奖及唯一约束。未重新抽取、回填或覆盖历史数据。
- 定时发布复用 Post 和审核服务。Post.publicationStatus 与 moderationStatus 分离，发布事件由唯一 postId 的 PostPublicationEvent 表承载。迁移默认历史帖子 publicationStatus=PUBLISHED，不执行历史 UPDATE；Post.publishedAt 改为可空以支持待发布帖子。
- 正式发布资格现要求帖子同时满足 status=PUBLISHED、moderationStatus=APPROVED、publicationStatus=PUBLISHED、publishedAt 非空且未删除。奖励、徽章和公开副作用只在唯一发布事件处理时运行。新增测试覆盖审核通过但尚未公开的帖子不获得发布奖励。
- 活动公开名单只读取正式完成且记录数、开奖时间、奖品和用户关联完整的 LotteryEntry；不完整记录不部分公开。用户公开昵称、头像之外的内部 ID 和联系方式不进入公开结果。后台通过 activity_manage 读取完整记录。

## 修改文件

定时发布及审核、可见性和后台任务：

- app/admin/posts/review/PostReviewManager.tsx
- app/admin/review/ReviewCenter.tsx
- app/api/admin/posts/review/route.ts
- app/api/admin/review/route.ts
- app/api/internal/daily-jobs/scheduled-post-publication/route.ts
- app/api/posts/[postId]/route.ts
- app/api/posts/[postId]/schedule/route.ts
- app/api/posts/route.ts
- app/api/users/[userId]/public-modules/route.ts
- app/post/submitted/page.tsx
- app/posts/[postId]/page.tsx
- app/posts/new/page.tsx
- components/PostCreateForm.tsx
- components/PostScheduleCancelButton.tsx
- components/PublicUserModules.tsx
- lib/badge-metrics.ts
- lib/post-deletion.ts
- lib/post-moderation.ts
- lib/post-publication.ts
- lib/post-scheduling.ts
- lib/review-center.ts
- lib/topic-activity-v2.ts
- ops/cron/scheduled-post-publication.cron.example
- prisma/migrations/20261105120000_add_scheduled_post_publication/migration.sql
- scripts/run-scheduled-post-publication-job.sh
- tests/post-moderation-reversal.test.ts
- tests/post-review-state-consistency.test.ts
- tests/post-scheduling.test.ts
- tests/profile-post-visibility.test.ts

活动开奖记录及共用回归：

- components/activities/ActivityDetailView.tsx
- components/activities/ActivityLotteryManager.tsx
- components/activities/ActivityLotteryPanel.tsx
- lib/activity-lottery.ts
- lib/activity-lottery-records.ts
- prisma/migrations/20261105090000_add_activity_lottery_draw_source/migration.sql
- tests/activity-cancellation.test.ts
- tests/activity-lottery-records.test.ts
- tests/easmusic-mobile-parity.test.ts
- prisma/schema.prisma
- lib/growth-tasks/service.ts
- tests/badge-rule-engine.test.ts
- tests/badge-validity.test.ts
- tests/growth-latest-rules.test.ts
- tests/post-edit-regression.test.ts
- tests/post-section-config.test.ts

来源审计及本报告：

- docs/scheduled-post-publishing-audit-2026-11-05.md
- docs/activity-lottery-records-public-winners-audit-2026-11-05.md
- docs/combined-scheduled-post-and-lottery-records-audit-2026-11-05.md

## 测试、类型、Lint 与构建

- 功能及回归测试：219 项中 218 通过，1 项失败。唯一失败是 activity-registration-workflow 的活动卡片比例断言；在最新 main 临时基线相同失败。除此以外，本次两项功能和其相关发帖审核回归为 218/218 通过。
- 全仓测试：4557 项，4522 通过、11 失败、24 跳过。11 项失败逐项与最新 main 基线复现一致；分支最初额外出现的 6 项旧断言已更新为验证 outbox 公开时机、奖励资格、取消编辑权限和板块计数语义，修复后通过。
- 最新 main 临时基线全仓运行：4534 项，4497 通过、13 失败、24 跳过。与集成分支共有的 11 项失败为 activity-registration-workflow、friend-display-name、friend-remark-unification、guess-song-duel-transaction-retry、home-hero-cta、notification-no-badge-rendering、topic-activity-hotfix-v4、topic-activity-post-participation、topic-activity-v3-platform，以及 topic-v2-main-integration 的两项。基线临时环境另有 easmusic-mobile-parity 和 migration-preflight 测试失败；集成分支这两项通过。
- 全仓 TypeScript：1 项错误，tests/android-rc11-publish-infrastructure.test.ts 引用 scripts/android-rc13-release.mjs 缺少声明文件。在最新 main 的相同依赖环境发现同一错误；本次修改没有新增 TypeScript 错误。
- 全仓 ESLint：14 个错误、135 个 warning。14 个错误全部位于未修改的 .github/release/production-anywhere-door-diagnostic-v2.cjs、.github/release/test-production-anywhere-door-diagnostic-v2.cjs、.github/release/test-production-anywhere-door-manual-trace.cjs，均为 require-import 规则错误。全部改动文件 ESLint 为 0 错误、4 个既有 img 性能 warning。
- Next.js production build：成功；Next 15.5.20 编译通过并生成 123/123 静态页面。存在两条 Webpack circular chunk warning；构建通过不代表生产部署验证。
- Prisma schema validate：通过。Prisma Client v6.19.3 generate：通过。
- MySQL migration 静态检查：通过，检查 161 条 MySQL-native migration，跳过 21 条 legacy migration。这不是迁移执行或数据库验证。
- git diff --check：通过。

## MySQL、迁移及历史数据状态

- 当前没有 DATABASE_URL、MYSQL_TEST_DATABASE_URL 或 TEST_DATABASE_URL 测试配置，也没有本地 mysql / mariadb CLI；未发现安全隔离的独立测试 MySQL。
- 未执行任何真实数据库迁移，未查询生产 migration ledger，未对生产数据库执行读取或写入。
- 下列项目均为 BLOCKED / NOT RUN：两项迁移实际执行及顺序验证；迁移前后历史帖子状态验证；历史活动/中奖行完整性统计；新旧 drawSource 数据验证；两实例并发；取消与审核竞态；任务崩溃、连接中断和重试；重复开奖与重复奖励；多批次真实数据隔离。
- 历史 LotteryEntry 实际完整率、缺少用户/奖品关联的行数、开奖时间/人数缺失范围未知。接口对不完整活动隐藏中奖名单并在后台标记，不猜测、补造或重抽。

## 定时任务与生产发布准备

- 内部 POST 任务 API 对 DAILY_JOB_SECRET 使用长度校验和 timingSafeEqual；缺配置返回 503，鉴权失败返回 403。
- cron 示例为每分钟运行，连接超时默认 3 秒、总超时默认 50 秒；失败返回非零、写专用日志并发送 syslog error。连续失败三次后向有 post_manage 权限管理员发送幂等通知。
- 每轮最多扫描 100 个到期帖子和 100 个发布事件；发布事件条件更新领取、Post/事件行锁、唯一 outbox、过期 lease 和心跳用于多实例保护。失败使用指数退避，最长 60 分钟。
- 上述并发与故障恢复仅完成源码和结构测试检查，没有真实 MySQL 或生产等效负载数据。100 条批次在 50 秒内完成、积压清空速率和数据库压力尚未实测；任务计数日志只能显示本轮批次，未验证专用积压告警。syslog 接收端、cron 实际安装状态和生产 DAILY_JOB_SECRET 均未验证。
- 已检查 GitHub Actions：常规生产 deploy 使用受保护的 Production environment 和 main 发布路径；部署脚本有 migration 检查、prisma migrate deploy/status、应用健康检查及应用版本回滚。仓库流程没有找到生产备份并验证可恢复的步骤；数据库备份、恢复演练和生产 ledger 检查必须在正式发布时由授权流程完成。

## 发布及回滚方案

解除 BLOCKED 后，先在隔离 MySQL 完成两项迁移、历史数据与并发验收，再通过正常审核建立一个统一 PR。PR 合并且受保护发布门禁批准后，按顺序执行：生产备份并验证可恢复；只读核对 ledger 和 schema；依次应用 lottery drawSource、Post publication migrations；核验历史数据；部署应用；安装每分钟 cron；验证密钥拒绝/允许、到期发布、活动后台及前台名单、奖励幂等；观察日志和队列积压。

迁移为增量兼容变更，仓库没有自动数据库 down migration。若应用发布失败，使用现有部署流程回滚应用代码，保留已应用 schema 和数据，不直接删除新列/表；按生产现场决定暂停 cron，并通过修复版本向前恢复。任务事件与 LotteryEntry 记录应保留用于续跑与审计。任何迁移或健康检查失败时停止后续发布步骤。

## 阻塞项

1. 未取得独立测试 MySQL，无法完成最高优先级的真实并发、故障注入和 migration deploy 验收。
2. 历史中奖记录完整性以及生产 migration ledger 未核验。
3. 全仓测试仍有 11 项与 main 相同失败；全仓 TypeScript 1 项基线错误；全仓 ESLint 14 项未修改文件错误。相关功能改动文件定向测试和 ESLint 通过，但仓库门禁是否接受这些基线错误须由正常审核确认。
4. 生产备份恢复能力、50 秒任务负载、真实 cron、告警接收和生产 smoke test 均未验证。

因此未创建 PR，最终状态为 BLOCKED。
