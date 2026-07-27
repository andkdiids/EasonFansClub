import { appendFileSync } from "node:fs";
import { ERROR_LOG_PATH } from "./config";

export interface MigrationErrorContext {
  model: string;
  record?: unknown;
  offset?: number;
}

export function logModelStart(model: string, count: number): void {
  console.log(`\n开始迁移：\n${model}\n`);
  console.log(`读取数量：\n${count}\n`);
}

export function logModelResult(success: number, failed: number): void {
  console.log(`成功写入：\n${success}\n`);
  console.log(`失败：\n${failed}\n`);
}

export function logMigrationError(
  error: unknown,
  context: MigrationErrorContext,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    ...context,
    error: serializeError(error),
  };
  appendFileSync(
    ERROR_LOG_PATH,
    `${JSON.stringify(entry, jsonReplacer)}\n`,
    "utf8",
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as { code?: unknown }).code,
    };
  }
  return error;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
