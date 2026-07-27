# PostgreSQL → MySQL 数据迁移工具

本工具将 Supabase PostgreSQL 数据分批复制到腾讯云 CynosDB MySQL 8.0。
它只读取 PostgreSQL，不包含删除、`DROP TABLE` 或 `TRUNCATE` 操作。

## 连接配置

建议在 `.env` 中使用迁移专用变量：

```dotenv
MIGRATION_POSTGRES_URL="postgresql://..."
MIGRATION_MYSQL_URL="mysql://..."
```

兼容项目现有变量：

- PostgreSQL：依次读取 `MIGRATION_POSTGRES_URL`、`DIRECT_URL`、`DATABASE_URL`
- MySQL：依次读取 `MIGRATION_MYSQL_URL`、`MYSQL_TEST_URL`
- 可选批次大小：`MIGRATION_BATCH_SIZE=500`

工具读取 `prisma/schema.prisma` 和
`prisma/schema.mysql-test.prisma`，启动时分别生成隔离的 Prisma Client。
隔离生成可避免以下两个命令默认写入同一个 Client 目录而互相覆盖：

```bash
pnpm exec prisma generate --schema prisma/schema.prisma
pnpm exec prisma generate --schema prisma/schema.mysql-test.prisma
```

## 使用方法

第一次先执行只读统计：

```bash
pnpm migration --dry-run
```

该命令只统计用户、帖子、评论和图片数量，不连接或写入 MySQL。

确认统计无误后执行完整迁移：

```bash
pnpm migration
```

只迁移指定 Prisma 模型：

```bash
pnpm migration --only User
```

从检查点继续：

```bash
pnpm migration --resume
```

项目中的业务名称 `Comment`、`NotificationRead`、`Message`、`Friend`
会分别映射到当前 schema 的 `Reply`、`SystemNotificationRead`、
`DirectMessage`、`Friendship`。

## 顺序、断点与错误

工具优先采用需求定义的四个阶段，再自动扫描剩余 Prisma model。
实际执行前会根据 `@relation(fields: ...)` 把被依赖模型提前，例如先迁移
`BoardCategory` 再迁移 `Board`。带 `@@ignore` 的备份表不会迁移。

每批成功后，检查点写入
`scripts/database-migration/.migration-state.json`。使用 `--resume` 时会跳过
已完成模型并从批次偏移继续。重复主键或唯一键通过 `skipDuplicates` 安全跳过。

批次写入失败时会自动逐行重试。非重复错误追加到
`scripts/database-migration/migration-error.log`，其中包括模型、偏移、记录与错误。

> 迁移前请确认 MySQL 的 99 张表结构与当前 schema 一致，并先做好数据库备份。
> 本工具不会清空目标表；在已有数据的 MySQL 上运行时，重复数据会被跳过。
