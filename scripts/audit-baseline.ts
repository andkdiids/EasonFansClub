import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE_PATH = path.resolve(PROJECT_ROOT, 'prisma/baseline-draft/0_init_baseline/migration.sql')

export type BaselineAuditReport = {
  generated: boolean
  passed: boolean
  counts: {
    createTable: number
    primaryKey: number
    foreignKey: number
    index: number
    uniqueIndex: number
    enum: number
    varchar: number
    text: number
    longtext: number
    datetime3: number
    deleteAction: number
    updateAction: number
    charsetCollation: number
  }
  checks: Record<string, boolean>
  details: string[]
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

export function auditBaselineSql(sql: string): BaselineAuditReport {
  const counts = {
    createTable: count(sql, /\bCREATE\s+TABLE\b/gi),
    primaryKey: count(sql, /\bPRIMARY\s+KEY\b/gi),
    foreignKey: count(sql, /\bFOREIGN\s+KEY\b/gi),
    index: count(sql, /\bINDEX\b/gi),
    uniqueIndex: count(sql, /\bUNIQUE\s+INDEX\b/gi),
    enum: count(sql, /\bENUM\s*\(/gi),
    varchar: count(sql, /\bVARCHAR\s*\(\d+\)/gi),
    text: count(sql, /\bTEXT\b/gi),
    longtext: count(sql, /\bLONGTEXT\b/gi),
    datetime3: count(sql, /\bDATETIME\s*\(3\)/gi),
    deleteAction: count(sql, /\bON\s+DELETE\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION)\b/gi),
    updateAction: count(sql, /\bON\s+UPDATE\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION)\b/gi),
    charsetCollation: count(sql, /DEFAULT\s+CHARACTER\s+SET\s+\w+\s+COLLATE\s+\w+/gi),
  }
  const checks = {
    createTable: counts.createTable > 0,
    primaryKey: counts.primaryKey > 0,
    foreignKey: counts.foreignKey > 0,
    indexes: counts.index > 0,
    uniqueIndexes: counts.uniqueIndex > 0,
    enumMapping: counts.enum > 0,
    varcharLengths: counts.varchar > 0 && !/\bVARCHAR(?!\s*\()/i.test(sql),
    textMapping: counts.text + counts.longtext > 0,
    datetimePrecision: counts.datetime3 > 0 && !/\bDATETIME(?!\s*\(\d+\))/i.test(sql),
    referentialActions: counts.foreignKey === 0 || (counts.deleteAction >= counts.foreignKey && counts.updateAction >= counts.foreignKey),
    charsetCollation: counts.charsetCollation >= counts.createTable,
  }
  const details = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => `${name} check failed`)
  return {
    generated: true,
    passed: details.length === 0,
    counts,
    checks,
    details,
  }
}

export function auditBaselineFile(filePath = BASELINE_PATH): BaselineAuditReport {
  if (!existsSync(filePath)) {
    return {
      generated: false,
      passed: false,
      counts: { createTable: 0, primaryKey: 0, foreignKey: 0, index: 0, uniqueIndex: 0, enum: 0, varchar: 0, text: 0, longtext: 0, datetime3: 0, deleteAction: 0, updateAction: 0, charsetCollation: 0 },
      checks: {},
      details: [`Baseline file missing: ${filePath}`],
    }
  }
  return auditBaselineSql(readFileSync(filePath, 'utf8'))
}

export function formatBaselineAudit(report: BaselineAuditReport): string {
  if (!report.generated) return `Baseline generated: NO\n${report.details.join('\n')}`
  const lines = [
    `Baseline generated: YES`,
    `CREATE TABLE: ${report.counts.createTable}`,
    `PRIMARY KEY: ${report.counts.primaryKey}`,
    `FOREIGN KEY: ${report.counts.foreignKey}`,
    `INDEX: ${report.counts.index}`,
    `UNIQUE INDEX: ${report.counts.uniqueIndex}`,
    `ENUM mapping: ${report.counts.enum}`,
    `VARCHAR(length): ${report.counts.varchar}`,
    `TEXT/LONGTEXT: ${report.counts.text}/${report.counts.longtext}`,
    `DATETIME(3): ${report.counts.datetime3}`,
    `ON DELETE/ON UPDATE: ${report.counts.deleteAction}/${report.counts.updateAction}`,
    `charset/collation clauses: ${report.counts.charsetCollation}`,
    `Baseline static validation: ${report.passed ? 'PASS' : 'FAIL'}`,
  ]
  for (const detail of report.details) lines.push(`  - ${detail}`)
  return lines.join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const report = auditBaselineFile()
  console.log(formatBaselineAudit(report))
  process.exitCode = report.passed ? 0 : 1
}
