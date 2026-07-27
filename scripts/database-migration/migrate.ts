import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  POSTGRES_SCHEMA,
  STATE_PATH,
  type GeneratedPrismaClient,
  loadConfig,
  loadPrismaModule,
} from "./config";
import {
  errorMessage,
  logMigrationError,
  logModelResult,
  logModelStart,
} from "./logger";
import { transformRecord } from "./transformers";

interface CliOptions {
  dryRun: boolean;
  only?: string;
  resume: boolean;
}

interface ModelInfo {
  name: string;
  dependencies: string[];
  ignored: boolean;
  primaryKey: string[];
}

interface MigrationState {
  completedModels: string[];
  offsets: Record<string, number>;
  updatedAt: string;
}

interface ModelStats {
  success: number;
  failed: number;
  skipped: number;
}

interface ModelDelegate {
  count(args?: unknown): Promise<number>;
  findMany(args: {
    skip: number;
    take: number;
    orderBy?: Array<Record<string, "asc">>;
  }): Promise<Array<Record<string, unknown>>>;
  createMany(args: {
    data: Array<Record<string, unknown>>;
    skipDuplicates: boolean;
  }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
}

const REQUESTED_PHASES = [
  [
    "User",
    "UserSecurityQuestion",
    "UserSecurityQuestionBackup",
    "Badge",
    "GrowthLevelConfig",
    "SiteSetting",
  ],
  ["Board", "Post", "PostMedia", "Comment", "PostFavorite"],
  [
    "CheckIn",
    "Notification",
    "NotificationRead",
    "Message",
    "Friend",
    "Activity",
  ],
  ["MusicAlbum", "MusicSong", "MusicTrack", "MusicFavorite"],
] as const;

const PROJECT_ALIASES: Record<string, string> = {
  Comment: "Reply",
  NotificationRead: "SystemNotificationRead",
  Message: "DirectMessage",
  Friend: "Friendship",
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options);
  const postgresModule = await loadPrismaModule("postgres");
  const postgres = new postgresModule.PrismaClient({
    datasourceUrl: config.postgresUrl,
  });

  try {
    if (options.dryRun) {
      await runDryRun(postgres);
      return;
    }

    const mysqlModule = await loadPrismaModule("mysql");
    const mysql = new mysqlModule.PrismaClient({
      datasourceUrl: config.mysqlUrl,
    });

    try {
      await runMigration(postgres, mysql, options, config.batchSize);
    } finally {
      await mysql.$disconnect();
    }
  } finally {
    await postgres.$disconnect();
  }
}

async function runDryRun(postgres: GeneratedPrismaClient): Promise<void> {
  const user = getDelegate(postgres, "User");
  const post = getDelegate(postgres, "Post");
  const reply = getDelegate(postgres, "Reply");
  const postMedia = getDelegate(postgres, "PostMedia");
  const [users, posts, comments, images] = await Promise.all([
    user.count(),
    post.count(),
    reply.count(),
    postMedia.count({ where: { type: "IMAGE" } }),
  ]);

  console.log("\nDry run：仅统计，不写入 MySQL\n");
  console.log(`用户数量：${users}`);
  console.log(`帖子数量：${posts}`);
  console.log(`评论数量：${comments}`);
  console.log(`图片数量：${images}`);
}

async function runMigration(
  postgres: GeneratedPrismaClient,
  mysql: GeneratedPrismaClient,
  options: CliOptions,
  batchSize: number,
): Promise<void> {
  const schema = readFileSync(POSTGRES_SCHEMA, "utf8");
  const models = parseModels(schema);
  const available = new Set(
    models.filter((model) => !model.ignored).map((model) => model.name),
  );
  const primaryKeys = new Map(
    models.map((model) => [model.name, model.primaryKey]),
  );
  const migrationOrder = buildMigrationOrder(models);
  const selectedModels = options.only
    ? [resolveOnlyModel(options.only, available)]
    : migrationOrder;
  const state = options.resume ? loadState() : freshState();

  console.log(`批次大小：${batchSize}`);
  console.log(`迁移模型数：${selectedModels.length}`);
  if (options.resume) {
    console.log("恢复模式：已启用");
  }

  for (const model of selectedModels) {
    if (options.resume && state.completedModels.includes(model)) {
      console.log(`\n跳过已完成模型：${model}`);
      continue;
    }
    await migrateModel(
      postgres,
      mysql,
      model,
      primaryKeys.get(model) ?? [],
      batchSize,
      state,
      options.resume,
    );
  }

  console.log("\n数据迁移流程完成。请检查各模型统计和 migration-error.log。");
}

async function migrateModel(
  postgres: GeneratedPrismaClient,
  mysql: GeneratedPrismaClient,
  model: string,
  primaryKey: string[],
  batchSize: number,
  state: MigrationState,
  resume: boolean,
): Promise<void> {
  const source = getDelegate(postgres, model);
  const target = getDelegate(mysql, model);
  const total = await source.count();
  const startOffset = resume ? (state.offsets[model] ?? 0) : 0;
  const stats: ModelStats = { success: 0, failed: 0, skipped: 0 };
  logModelStart(model, total);

  for (let offset = startOffset; offset < total; offset += batchSize) {
    const rows = (await source.findMany({
      skip: offset,
      take: batchSize,
      orderBy:
        primaryKey.length > 0
          ? primaryKey.map((field) => ({ [field]: "asc" }))
          : undefined,
    })) as Array<Record<string, unknown>>;
    const data = rows.map((row) => transformRecord(model, row));

    for (const record of data) {
  try {
    await target.create({
      data: record,
    });

    stats.success += 1;
  } catch (error) {
    if (isUniqueConflict(error)) {
      stats.skipped += 1;
      continue;
    }

    stats.failed += 1;

    logMigrationError(error, {
      model,
      record,
    });
  }
}
    

    state.offsets[model] = offset + rows.length;
    saveState(state);
  }

  if (!state.completedModels.includes(model)) {
    state.completedModels.push(model);
  }
  delete state.offsets[model];
  saveState(state);
  logModelResult(stats.success, stats.failed);
  if (stats.skipped > 0) {
    console.log(`跳过重复数据：${stats.skipped}\n`);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    resume: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--only") {
      const model = args[index + 1];
      if (!model || model.startsWith("--")) {
        throw new Error("--only 后必须提供 Prisma 模型名，例如 --only User。");
      }
      options.only = model;
      index += 1;
    } else if (arg.startsWith("--only=")) {
      options.only = arg.slice("--only=".length);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  if (options.dryRun && (options.only || options.resume)) {
    throw new Error("--dry-run 不能与 --only 或 --resume 同时使用。");
  }
  return options;
}

function parseModels(schema: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const match of schema.matchAll(modelPattern)) {
    const [, name, body] = match;
    const dependencies = new Set<string>();
    const relationPattern =
      /^\s+\w+\s+(\w+)[?\[\]]*\s+@relation\([^)]*fields:\s*\[[^\]]+\]/gm;
    for (const relation of body.matchAll(relationPattern)) {
      if (relation[1] !== name) {
        dependencies.add(relation[1]);
      }
    }
    models.push({
      name,
      dependencies: [...dependencies],
      ignored: /@@ignore\b/.test(body),
      primaryKey: parsePrimaryKey(body),
    });
  }
  return models;
}

function buildMigrationOrder(models: ModelInfo[]): string[] {
  const usable = models.filter((model) => !model.ignored);
  const byName = new Map(usable.map((model) => [model.name, model]));
  const requested = REQUESTED_PHASES.flatMap((phase) =>
    phase
      .map((name) => PROJECT_ALIASES[name] ?? name)
      .filter((name) => byName.has(name)),
  );
  const priority = [
    ...new Set([...requested, ...usable.map((model) => model.name)]),
  ];
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    // Self-relations and unavoidable schema cycles are handled by row order /
    // nullable keys; do not recurse forever.
    if (visiting.has(name)) return;
    visiting.add(name);
    for (const dependency of byName.get(name)?.dependencies ?? []) {
      if (byName.has(dependency)) visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };

  priority.forEach(visit);
  return ordered;
}

function resolveOnlyModel(input: string, available: Set<string>): string {
  const resolved = PROJECT_ALIASES[input] ?? input;

  if (available.has(resolved)) {
    return resolved;
  }

  const matched = [...available].find(
    (name) => name.toLowerCase() === resolved.toLowerCase()
  );

  if (matched) {
    return matched;
  }

  const matches = [...available]
    .filter((name) =>
      name.toLowerCase().includes(input.toLowerCase())
    )
    .slice(0, 8);

  const suggestion =
    matches.length > 0
      ? ` 可用的近似模型：${matches.join("、")}`
      : "";

  throw new Error(
    `模型 ${input} 不存在或已被 Prisma 忽略。${suggestion}`
  );
}

function parsePrimaryKey(body: string): string[] {
  const compound = body.match(/@@id\s*\(\s*\[([^\]]+)\]/);
  if (compound) {
    return compound[1].split(",").map((field) => field.trim());
  }
  const scalar = body.match(/^\s+(\w+)\s+[^\r\n]*@id\b/m);
  return scalar ? [scalar[1]] : [];
}

function getDelegate(
  client: GeneratedPrismaClient,
  model: string,
): ModelDelegate {
  const delegateName = `${model[0].toLowerCase()}${model.slice(1)}`;
  const delegate = client[delegateName];
  if (!delegate || typeof delegate !== "object") {
    throw new Error(`Prisma Client 中找不到模型代理：${model}`);
  }
  return delegate as ModelDelegate;
}

function freshState(): MigrationState {
  return { completedModels: [], offsets: {}, updatedAt: new Date().toISOString() };
}

function loadState(): MigrationState {
  if (!existsSync(STATE_PATH)) {
    console.log("未找到检查点，将从头开始迁移。");
    return freshState();
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as MigrationState;
}

function saveState(state: MigrationState): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

main().catch((error: unknown) => {
  console.error(`\n迁移终止：${errorMessage(error)}`);
  process.exitCode = 1;
});
