import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEGACY_MIGRATION_CUTOFF = 20260727220000
export const MYSQL_IDENTIFIER_MAX_LENGTH = 64

export type FindingSeverity = 'ERROR' | 'HIGH'

export type MigrationFinding = {
  code: string
  severity: FindingSeverity
  message: string
  line?: number
  snippet?: string
}

export type MigrationInspection = {
  name: string
  timestamp: number | null
  legacy: boolean
  findings: MigrationFinding[]
}

export type MigrationCheckResult = {
  cutoff: number
  legacy: MigrationInspection[]
  future: MigrationInspection[]
  findings: MigrationFinding[]
  passed: boolean
  highRisk: boolean
}

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type Pattern = {
  code: string
  message: string
  regex: RegExp
}

const POSTGRES_PATTERNS: Pattern[] = [
  { code: 'PG_CREATE_TYPE', message: 'PostgreSQL CREATE TYPE detected', regex: /\bCREATE\s+TYPE\b/gi },
  { code: 'PG_ALTER_TYPE', message: 'PostgreSQL ALTER TYPE detected', regex: /\bALTER\s+TYPE\b/gi },
  { code: 'PG_DROP_TYPE', message: 'PostgreSQL DROP TYPE detected', regex: /\bDROP\s+TYPE\b/gi },
  { code: 'PG_DO_BLOCK', message: 'PostgreSQL DO $$ block detected', regex: /\bDO\s+\$\$/gi },
  { code: 'PG_JSONB', message: 'PostgreSQL JSONB type detected', regex: /\bJSONB\b/gi },
  { code: 'PG_CAST_OPERATOR', message: 'PostgreSQL ::type cast detected', regex: /::\s*[A-Za-z_][\w$]*/g },
  { code: 'PG_ON_CONFLICT', message: 'PostgreSQL ON CONFLICT detected', regex: /\bON\s+CONFLICT\b/gi },
  { code: 'PG_AT_TIME_ZONE', message: 'PostgreSQL AT TIME ZONE detected', regex: /\bAT\s+TIME\s+ZONE\b/gi },
  { code: 'PG_CURRENT_SCHEMA', message: 'PostgreSQL current_schema() detected', regex: /\bcurrent_schema\s*\(/gi },
  { code: 'PG_RAISE_EXCEPTION', message: 'PostgreSQL RAISE EXCEPTION detected', regex: /\bRAISE\s+EXCEPTION\b/gi },
  { code: 'PG_TYPE_CATALOG', message: 'PostgreSQL pg_type catalog detected', regex: /\bpg_type\b/gi },
  { code: 'PG_SERIAL', message: 'PostgreSQL SERIAL type detected', regex: /\bSERIAL\b/gi },
  { code: 'PG_UUID_OSSP', message: 'PostgreSQL uuid-ossp extension detected', regex: /\buuid-ossp\b/gi },
  { code: 'PG_GEN_RANDOM_UUID', message: 'PostgreSQL gen_random_uuid() detected', regex: /\bgen_random_uuid\s*\(/gi },
  {
    code: 'PG_DOUBLE_QUOTED_IDENTIFIER',
    message: 'Double-quoted SQL identifier detected; use MySQL backticks',
    regex: /"(?:[^"]|"")*"/g,
  },
]

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

function snippetAt(source: string, index: number): string {
  const line = source.slice(0, index).split('\n').pop() ?? ''
  return line.trim().slice(0, 180)
}

/**
 * Removes SQL comments without treating comment-like text inside quoted
 * strings/identifiers as comments. Newlines are preserved for useful reports.
 */
export function stripSqlComments(sql: string): string {
  let output = ''
  let index = 0
  let quote: "'" | '"' | '`' | null = null

  while (index < sql.length) {
    const current = sql[index]
    const next = sql[index + 1]

    if (quote) {
      output += current
      if (current === '\\' && quote !== '`' && next) {
        output += next
        index += 2
        continue
      }
      if (current === quote) {
        if (next === quote) {
          output += next
          index += 2
          continue
        }
        quote = null
      }
      index += 1
      continue
    }

    if (current === "'" || current === '"' || current === '`') {
      quote = current
      output += current
      index += 1
      continue
    }

    if (current === '-' && next === '-' && (index + 2 >= sql.length || /\s/.test(sql[index + 2]))) {
      output += '  '
      index += 2
      while (index < sql.length && sql[index] !== '\n') {
        output += ' '
        index += 1
      }
      continue
    }

    if (current === '/' && next === '*') {
      output += '  '
      index += 2
      while (index < sql.length) {
        if (sql[index] === '*' && sql[index + 1] === '/') {
          output += '  '
          index += 2
          break
        }
        output += sql[index] === '\n' ? '\n' : ' '
        index += 1
      }
      continue
    }

    output += current
    index += 1
  }

  return output
}

function addPatternFindings(sql: string, findings: MigrationFinding[]) {
  for (const pattern of POSTGRES_PATTERNS) {
    pattern.regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.regex.exec(sql))) {
      findings.push({
        code: pattern.code,
        severity: 'ERROR',
        message: pattern.message,
        line: lineNumberAt(sql, match.index),
        snippet: snippetAt(sql, match.index),
      })
      if (!pattern.regex.global) break
    }
  }
}

function unquoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim()
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) return trimmed.slice(1, -1).replaceAll('``', '`')
  return trimmed
}

function addIdentifierLengthFindings(sql: string, findings: MigrationFinding[]) {
  const patterns = [
    /\b(?:UNIQUE\s+)?INDEX\s+(`(?:``|[^`])+`|[A-Za-z_][\w$]*)/gi,
    /\bCONSTRAINT\s+(`(?:``|[^`])+`|[A-Za-z_][\w$]*)/gi,
  ]

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(sql))) {
      const identifier = unquoteIdentifier(match[1])
      if ([...identifier].length <= MYSQL_IDENTIFIER_MAX_LENGTH) continue
      findings.push({
        code: 'MYSQL_IDENTIFIER_TOO_LONG',
        severity: 'ERROR',
        message: `MySQL identifier ${identifier} is ${[...identifier].length} characters; maximum is ${MYSQL_IDENTIFIER_MAX_LENGTH}`,
        line: lineNumberAt(sql, match.index),
        snippet: snippetAt(sql, match.index),
      })
    }
  }
}

function addReferentialActionRiskFinding(sql: string, findings: MigrationFinding[]) {
  if (!/\bCHECK\s*\(/i.test(sql)) return
  if (!/\bFOREIGN\s+KEY\b/i.test(sql)) return
  if (!/\bON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION)/i.test(sql)) return

  // MySQL 8.0.16+ allows CHECK constraints beside foreign keys. The risk is
  // specific to a CHECK and a referential action touching the same column;
  // flagging every migration that happens to contain both creates noise and
  // makes the preflight gate less useful. This intentionally stays a static
  // heuristic rather than pretending to be a full SQL parser.
  const checkColumns = new Set([...sql.matchAll(/\bCHECK\s*\(\s*(?:`([^`]+)`|([A-Za-z_]\w*))/gi)].map((match) => unquoteIdentifier(match[1] || match[2])))
  const foreignKeyColumns = new Set([...sql.matchAll(/\bFOREIGN\s+KEY\s*\(\s*(?:`([^`]+)`|([A-Za-z_]\w*))/gi)].map((match) => unquoteIdentifier(match[1] || match[2])))
  const sameColumn = [...checkColumns].some((column) => foreignKeyColumns.has(column))
  if (!sameColumn) return

  findings.push({
    code: 'MYSQL_3823_RISK',
    severity: 'HIGH',
    message: 'The migration combines CHECK constraints and referential actions; inspect whether the same field is covered before deployment',
    line: lineNumberAt(sql, Math.max(sql.search(/\bCHECK\s*\(/i), 0)),
    snippet: 'CHECK + FOREIGN KEY + ON DELETE/ON UPDATE',
  })
}

export function inspectMigrationSql(name: string, sql: string, legacy = false): MigrationInspection {
  const executableSql = stripSqlComments(sql)
  const findings: MigrationFinding[] = []
  if (!legacy) {
    addPatternFindings(executableSql, findings)
    addIdentifierLengthFindings(executableSql, findings)
    addReferentialActionRiskFinding(executableSql, findings)
  }

  return {
    name,
    timestamp: /^\d{14}/.test(name) ? Number(name.slice(0, 14)) : null,
    legacy,
    findings,
  }
}

function migrationTimestamp(name: string): number | null {
  return /^\d{14}/.test(name) ? Number(name.slice(0, 14)) : null
}

export function runMigrationMysqlCheck(rootDir = PROJECT_ROOT): MigrationCheckResult {
  const migrationsRoot = path.resolve(rootDir, 'prisma/migrations')
  const directories = readdirSync(migrationsRoot)
    .filter((name) => /^\d{14}_/.test(name))
    .filter((name) => statSync(path.resolve(migrationsRoot, name)).isDirectory())
    .sort()

  const inspections = directories.map((name) => {
    const timestamp = migrationTimestamp(name)
    const legacy = timestamp !== null && timestamp <= LEGACY_MIGRATION_CUTOFF
    const sqlPath = path.resolve(migrationsRoot, name, 'migration.sql')
    return inspectMigrationSql(name, readFileSync(sqlPath, 'utf8'), legacy)
  })

  const legacy = inspections.filter((inspection) => inspection.legacy)
  const future = inspections.filter((inspection) => !inspection.legacy)
  const findings = future.flatMap((inspection) => inspection.findings.map((finding) => ({
    ...finding,
    message: `${inspection.name}: ${finding.message}`,
  })))

  return {
    cutoff: LEGACY_MIGRATION_CUTOFF,
    legacy,
    future,
    findings,
    passed: !findings.some((finding) => finding.severity === 'ERROR'),
    highRisk: findings.some((finding) => finding.severity === 'HIGH'),
  }
}

export function formatMigrationCheck(result: MigrationCheckResult): string {
  const lines = [
    `LEGACY_MIGRATION_CUTOFF=${result.cutoff}`,
    `Legacy migrations skipped: ${result.legacy.length}`,
    `MySQL-native migrations checked: ${result.future.length}`,
  ]

  if (!result.findings.length) {
    lines.push('MySQL migration static check: PASS')
  } else {
    for (const finding of result.findings) {
      const location = finding.line ? `:${finding.line}` : ''
      lines.push(`[${finding.severity}] ${finding.code} ${location} ${finding.message}`)
      if (finding.snippet) lines.push(`  ${finding.snippet}`)
    }
    lines.push(`MySQL migration static check: ${result.passed ? 'PASS_WITH_HIGH_RISK' : 'FAIL'}`)
  }

  return lines.join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = runMigrationMysqlCheck()
  console.log(formatMigrationCheck(result))
  process.exitCode = result.passed ? 0 : 1
}
