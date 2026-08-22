# Database migration policy

## Database boundary

生产数据库统一按 MySQL 8 维护。所有新的 Prisma migration 必须使用 MySQL SQL，并在合并前通过：

```text
pnpm migration:check:mysql
pnpm migration:preflight
```

生产禁止使用 `prisma db push`。正式发布顺序必须是：

```text
migration:check:mysql
migration:preflight
staging migrate deploy
production migrate deploy
schema/database smoke test
```

`pnpm migration:preflight -- --production-readonly` 才会连接指定的 MySQL URL。该模式只执行 `SELECT` 和 Prisma migration status 读取，不会执行 DDL、DML、resolve 或 deploy。

## Historical boundary

`20260727220000` 及之前的 21 个目录属于 `LEGACY_MIGRATION`。它们源于 PostgreSQL 阶段，生产 MySQL 已通过历史迁移、人工结构同步或人工 resolve 等方式具备对应结构；它们不再作为“空 MySQL 可回放 migration chain”维护。

`20260729010000` 之后的 migration 目标数据库统一为 MySQL，但这不代表所有历史 SQL 从未出过问题。包括 `20260815090000_add_song_ratings`、`20260805120000_add_concert_stage_type`、`20260818210000_repair_admin_action_audit_fields` 等文件仍必须经过 MySQL preflight 和干净库测试。

已 applied migration 禁止修改。若仓库文件与生产 checksum 不同，差异作为历史事实记录，不通过继续修改旧文件追 checksum。当前已知例外记录见 `prisma/migration-history.json`。

## Existing structure without migration history

生产已经存在、但 `_prisma_migrations` 没有登记的表，禁止直接 `migrate deploy`。先做只读 DDL equivalence audit，再由人工决定：

```text
prisma migrate resolve --applied <migration-name>
```

应用和脚本都不得自动执行 `resolve --applied`。

`20260821120000_add_rate_limit_log` 的 RateLimitLog 表来源仍然是 `UNKNOWN`。仓库中的 `prisma/manual_ehospital.sql` 只是候选线索，不能证明生产实际来源。

生产历史已经确认是 `FAILED_THEN_APPLIED`：第一次记录因 MySQL 1050（RateLimitLog 已存在）rolled back，随后存在 `finished_at` 非空、`rolled_back_at` 为空的成功记录；成功记录 checksum 与仓库 migration checksum 一致，生产结构也等价。因此当前不需要任何额外 migration 操作，且：

- DO NOT run `resolve --applied` again。
- DO NOT create reconciliation migration。
- DO NOT modify the applied migration。

该历史问题属于来源溯源记录，不再阻塞应用发布。只有未来生产表结构或 migration history 再次发生变化时，才重新进行审计。

## Baseline

Baseline 只能放在 `prisma/baseline-draft/`，不能放入 `prisma/migrations/`，也不能修改 `_prisma_migrations`。生成和静态审计：

```text
pnpm migration:baseline:generate
pnpm migration:check:mysql
```

本地没有 MySQL runtime 时，不得声称 baseline 已通过真实空库回放。
