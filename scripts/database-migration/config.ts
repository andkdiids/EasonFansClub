import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
export const MIGRATION_ROOT = path.resolve(PROJECT_ROOT, "scripts/database-migration");
export const POSTGRES_SCHEMA = path.resolve(PROJECT_ROOT, "prisma/schema.prisma");
export const MYSQL_SCHEMA = path.resolve(
  PROJECT_ROOT,
  "prisma/schema.mysql-test.prisma",
);
export const ERROR_LOG_PATH = path.resolve(MIGRATION_ROOT, "migration-error.log");
export const STATE_PATH = path.resolve(MIGRATION_ROOT, ".migration-state.json");

const projectEnvPath = path.resolve(PROJECT_ROOT, ".env");
if (existsSync(projectEnvPath)) {
  process.loadEnvFile(projectEnvPath);
}
export const BATCH_SIZE = positiveInteger(process.env.MIGRATION_BATCH_SIZE, 500);

export type DatabaseKind = "postgres" | "mysql";

export interface MigrationConfig {
  postgresUrl: string;
  mysqlUrl?: string;
  batchSize: number;
}

export interface GeneratedPrismaClient {
  $disconnect(): Promise<void>;
  [key: string]: unknown;
}

export interface GeneratedPrismaModule {
  PrismaClient: new (options: {
    datasourceUrl?: string;
  }) => GeneratedPrismaClient;
}

export function loadConfig(options: { dryRun: boolean }): MigrationConfig {
  const postgresUrl =
    process.env.MIGRATION_POSTGRES_URL ??
    process.env.DIRECT_URL ??
    process.env.DATABASE_URL;
  const mysqlUrl =
    process.env.MIGRATION_MYSQL_URL ?? process.env.MYSQL_TEST_URL;

  if (!postgresUrl) {
    throw new Error(
      "缺少 PostgreSQL 连接串：请设置 MIGRATION_POSTGRES_URL、DIRECT_URL 或 DATABASE_URL。",
    );
  }
  if (!options.dryRun && !mysqlUrl) {
    throw new Error(
      "缺少 MySQL 连接串：请设置 MIGRATION_MYSQL_URL 或 MYSQL_TEST_URL。",
    );
  }

  return { postgresUrl, mysqlUrl, batchSize: BATCH_SIZE };
}

/**
 * Prisma CLI normally generates both schemas into the same @prisma/client
 * directory. This creates temporary schema copies with isolated output paths,
 * while continuing to read the two canonical schemas requested by the project.
 */
export function ensureGeneratedClient(kind: DatabaseKind): string {
  const sourcePath = kind === "postgres" ? POSTGRES_SCHEMA : MYSQL_SCHEMA;
  const runtimeRoot = path.resolve(MIGRATION_ROOT, ".runtime");
  const outputRoot = path.resolve(MIGRATION_ROOT, ".generated", kind);
  const runtimeSchema = path.resolve(runtimeRoot, `${kind}.prisma`);
  const fingerprintPath = path.resolve(outputRoot, ".schema.sha256");
  const source = readFileSync(sourcePath, "utf8");
  const fingerprint = createHash("sha256").update(source).digest("hex");
  const entryPath = path.resolve(outputRoot, "index.js");

  if (
    existsSync(entryPath) &&
    existsSync(fingerprintPath) &&
    readFileSync(fingerprintPath, "utf8") === fingerprint
  ) {
    return entryPath;
  }

  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });

  const outputForPrisma = path
    .relative(runtimeRoot, outputRoot)
    .replaceAll("\\", "/");
  const generatedSchema = addGeneratorOutput(source, outputForPrisma);
  writeFileSync(runtimeSchema, generatedSchema, "utf8");

  const command =
  process.platform === "win32" ? "cmd.exe" : "pnpm";

const args =
  process.platform === "win32"
    ? [
        "/c",
        "pnpm",
        "exec",
        "prisma",
        "generate",
        "--schema",
        runtimeSchema,
      ]
    : [
        "exec",
        "prisma",
        "generate",
        "--schema",
        runtimeSchema,
      ];

execFileSync(command, args, {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  env: process.env,
});

  writeFileSync(fingerprintPath, fingerprint, "utf8");
  return entryPath;
}

export async function loadPrismaModule(
  kind: DatabaseKind,
): Promise<GeneratedPrismaModule> {
  const entryPath = ensureGeneratedClient(kind);
  return import(pathToFileURL(entryPath).href) as Promise<GeneratedPrismaModule>;
}

function addGeneratorOutput(schema: string, output: string): string {
  const generatorPattern = /(generator\s+client\s*\{)([\s\S]*?)(\r?\n\})/;
  const match = schema.match(generatorPattern);
  if (!match) {
    throw new Error("Prisma schema 中找不到 generator client 配置。");
  }

  let body = match[2].replace(/^\s*output\s*=.*(?:\r?\n|$)/m, "");
  body = `${body.trimEnd()}\n  output = "${output}"`;
  return schema.replace(generatorPattern, `${match[1]}${body}${match[3]}`);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
