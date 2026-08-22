import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureGeneratedClient } from './database-migration/config'
import { auditBaselineFile, formatBaselineAudit } from './audit-baseline'
import {
  formatMigrationCheck,
  inspectMigrationSql,
  runMigrationMysqlCheck,
  type MigrationFinding,
} from './check-migrations-mysql'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_PATH = path.resolve(PROJECT_ROOT, 'prisma/schema.prisma')
const RATE_LIMIT_MIGRATION_PATH = path.resolve(PROJECT_ROOT, 'prisma/migrations/20260821120000_add_rate_limit_log/migration.sql')
const HONOR_MIGRATION_PATH = path.resolve(PROJECT_ROOT, 'prisma/migrations/20260821153000_add_honor_badge_system/migration.sql')
const BADGE_RULE_MIGRATION_PATH = path.resolve(PROJECT_ROOT, 'prisma/migrations/20260822100000_add_badge_auto_rules/migration.sql')
const MYSQL_RAW_CLIENT_PATH = path.resolve(PROJECT_ROOT, 'scripts/database-migration/.generated/mysql/index.js')

const RATE_LIMIT_MIGRATION = '20260821120000_add_rate_limit_log'
const HONOR_BADGE_MIGRATION = '20260821153000_add_honor_badge_system'
const BADGE_RULE_MIGRATION = '20260822100000_add_badge_auto_rules'

type RawRow = Record<string, unknown>
type ReadonlyDatabase = {
  $disconnect(): Promise<void>
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

type TableInfo = {
  engine: string | null
  tableCollation: string | null
}

type ColumnInfo = {
  columnName: string
  columnType: string
  isNullable: string
  columnDefault: unknown
  extra: string
  characterSetName: string | null
  collationName: string | null
}

type IndexInfo = {
  indexName: string
  nonUnique: number
  seqInIndex: number
  columnName: string
  indexType: string
}

type ForeignKeyInfo = {
  constraintName: string
  columnName: string
  referencedTableName: string | null
  referencedColumnName: string | null
  deleteRule: string | null
  updateRule: string | null
}

export type MigrationStatus = {
  id: string
  migrationName: string
  checksum: string
  startedAt: unknown
  finishedAt: unknown
  rolledBackAt: unknown
  appliedStepsCount: number
  logs: string | null
}

export type MigrationHistoryStatus =
  | 'ABSENT'
  | 'ROLLED_BACK_ONLY'
  | 'FAILED_THEN_APPLIED'
  | 'CHECKSUM_DRIFT'
  | 'HISTORY_INCONSISTENT'
  | 'APPLIED'

export type MigrationHistoryAssessment = {
  status: MigrationHistoryStatus
  records: MigrationStatus[]
  successfulRecords: MigrationStatus[]
  rolledBackRecords: MigrationStatus[]
  repositoryChecksum: string | null
  repositoryChecksumMatchesProduction: boolean | null
  severity: 'NONE' | 'WARN' | 'HIGH'
  blocking: boolean
  details: string[]
}

export type RateLimitEquivalenceReport = {
  history: MigrationHistoryStatus
  historySeverity: MigrationHistoryAssessment['severity']
  repositoryChecksum: string
  repositoryChecksumMatchesProduction: boolean | null
  blocking: boolean
  tableExists: boolean
  migrationTableReadable: boolean
  migrationRecordExists: boolean
  migrationRecordState: string
  migrationRegistered: boolean
  columnsEquivalent: boolean
  indexesEquivalent: boolean
  engineEquivalent: boolean
  collationCompatible: boolean
  safeToResolve: boolean
  details: string[]
}

export type HonorBadgePreflightReport = {
  status: 'SAFE_TO_DEPLOY' | 'NOT_SAFE_TO_DEPLOY'
  migrationTableReadable: boolean
  migrationRecordExists: boolean
  migrationRecordState: string
  migrationRegistered: boolean
  baseTablesPresent: boolean
  targetColumnsAbsent: boolean
  targetColumnsPresent: boolean
  badgeData: {
    total: number | null
    nonNullSlug: number | null
    distinctSlug: number | null
    nonNullCode: number | null
    distinctCode: number | null
    codeMismatchCount: number | null
    duplicateSlugCount: number | null
    blankSlugCount: number | null
    untrimmedSlugCount: number | null
    caseInsensitiveDuplicateCount: number | null
    slugCollation: string | null
  }
  userBadgeData: {
    total: number | null
    grantedAtNonNull: number | null
    obtainedAtNonNull: number | null
    createdAtNonNull: number | null
  }
  ddl: {
    codeBackfillOrderSafe: boolean
    userBadgeBackfillOrderSafe: boolean
    equippedBadgeForeignKeySafe: boolean
    grantedByForeignKeySafe: boolean
    badgeRuleSchemaSafe: boolean
    noAutomaticRuleBackfill: boolean
  }
  badgeRuleRuntimeState: string
  birthdayAutoCompatibility: string
  details: string[]
}

type HonorMigrationDdlReport = HonorBadgePreflightReport['ddl']

function sqlIdentifierLiteral(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
  return `'${value}'`
}

async function queryRows<T extends RawRow>(db: ReadonlyDatabase, sql: string): Promise<T[]> {
  return db.$queryRawUnsafe<T[]>(sql)
}

async function getTableInfo(db: ReadonlyDatabase, tableName: string): Promise<TableInfo | null> {
  const rows = await queryRows<RawRow>(db, `
    SELECT ENGINE AS engine, TABLE_COLLATION AS tableCollation
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlIdentifierLiteral(tableName)}
    LIMIT 1
  `)
  if (!rows[0]) return null
  return {
    engine: rows[0].engine == null ? null : String(rows[0].engine),
    tableCollation: rows[0].tableCollation == null ? null : String(rows[0].tableCollation),
  }
}

async function getColumns(db: ReadonlyDatabase, tableName: string): Promise<ColumnInfo[]> {
  const rows = await queryRows<RawRow>(db, `
    SELECT
      COLUMN_NAME AS columnName,
      COLUMN_TYPE AS columnType,
      IS_NULLABLE AS isNullable,
      COLUMN_DEFAULT AS columnDefault,
      EXTRA AS extra,
      CHARACTER_SET_NAME AS characterSetName,
      COLLATION_NAME AS collationName
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlIdentifierLiteral(tableName)}
    ORDER BY ORDINAL_POSITION
  `)
  return rows.map((row) => ({
    columnName: String(row.columnName),
    columnType: String(row.columnType).toLowerCase(),
    isNullable: String(row.isNullable).toUpperCase(),
    columnDefault: row.columnDefault,
    extra: String(row.extra ?? '').toUpperCase(),
    characterSetName: row.characterSetName == null ? null : String(row.characterSetName),
    collationName: row.collationName == null ? null : String(row.collationName),
  }))
}

async function getIndexes(db: ReadonlyDatabase, tableName: string): Promise<IndexInfo[]> {
  const rows = await queryRows<RawRow>(db, `
    SELECT
      INDEX_NAME AS indexName,
      NON_UNIQUE AS nonUnique,
      SEQ_IN_INDEX AS seqInIndex,
      COLUMN_NAME AS columnName,
      INDEX_TYPE AS indexType
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlIdentifierLiteral(tableName)}
    ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `)
  return rows.map((row) => ({
    indexName: String(row.indexName),
    nonUnique: Number(row.nonUnique),
    seqInIndex: Number(row.seqInIndex),
    columnName: String(row.columnName),
    indexType: String(row.indexType).toUpperCase(),
  }))
}

async function getForeignKeys(db: ReadonlyDatabase, tableName: string): Promise<ForeignKeyInfo[]> {
  const rows = await queryRows<RawRow>(db, `
    SELECT
      k.CONSTRAINT_NAME AS constraintName,
      k.COLUMN_NAME AS columnName,
      k.REFERENCED_TABLE_NAME AS referencedTableName,
      k.REFERENCED_COLUMN_NAME AS referencedColumnName,
      r.DELETE_RULE AS deleteRule,
      r.UPDATE_RULE AS updateRule
    FROM information_schema.KEY_COLUMN_USAGE k
    LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
      AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND k.TABLE_NAME = ${sqlIdentifierLiteral(tableName)}
      AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
  `)
  return rows.map((row) => ({
    constraintName: String(row.constraintName),
    columnName: String(row.columnName),
    referencedTableName: row.referencedTableName == null ? null : String(row.referencedTableName),
    referencedColumnName: row.referencedColumnName == null ? null : String(row.referencedColumnName),
    deleteRule: row.deleteRule == null ? null : String(row.deleteRule).toUpperCase(),
    updateRule: row.updateRule == null ? null : String(row.updateRule).toUpperCase(),
  }))
}

async function getMigrationStatuses(db: ReadonlyDatabase, names: string[]): Promise<{
  readable: boolean
  statuses: MigrationStatus[]
}> {
  try {
    const table = await getTableInfo(db, '_prisma_migrations')
    if (!table) return { readable: false, statuses: [] }
    const values = names.map(sqlIdentifierLiteral).join(', ')
    const rows = await queryRows<RawRow>(db, `
      SELECT id, migration_name AS migrationName, checksum,
             started_at AS startedAt, finished_at AS finishedAt,
             rolled_back_at AS rolledBackAt, applied_steps_count AS appliedStepsCount,
             logs
      FROM _prisma_migrations
      WHERE migration_name IN (${values})
      ORDER BY migration_name, started_at, id
    `)
    return {
      readable: true,
      statuses: rows.map((row) => ({
        id: String(row.id),
        migrationName: String(row.migrationName),
        checksum: String(row.checksum),
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        rolledBackAt: row.rolledBackAt,
        appliedStepsCount: Number(row.appliedStepsCount),
        logs: row.logs == null ? null : String(row.logs),
      })),
    }
  } catch {
    return { readable: false, statuses: [] }
  }
}

function asNumber(value: unknown): number | null {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeDefault(value: unknown): string | null {
  if (value == null) return null
  let normalized = String(value).trim().toLowerCase().replace(/\s+/g, '')
  while (normalized.startsWith('(') && normalized.endsWith(')')) normalized = normalized.slice(1, -1)
  return normalized
}

function normalizeExtra(value: string): string {
  return value.trim().toUpperCase()
}

function columnEquivalent(actual: ColumnInfo, expected: Partial<ColumnInfo> & { columnName: string; allowedExtra?: string[] }): boolean {
  if (actual.columnName !== expected.columnName) return false
  if (expected.columnType && actual.columnType !== expected.columnType.toLowerCase()) return false
  if (expected.isNullable && actual.isNullable !== expected.isNullable) return false
  if (Object.prototype.hasOwnProperty.call(expected, 'columnDefault') && normalizeDefault(actual.columnDefault) !== normalizeDefault(expected.columnDefault)) return false
  if (expected.allowedExtra && !expected.allowedExtra.includes(normalizeExtra(actual.extra))) return false
  if (Object.prototype.hasOwnProperty.call(expected, 'characterSetName') && actual.characterSetName !== expected.characterSetName) return false
  if (Object.prototype.hasOwnProperty.call(expected, 'collationName') && actual.collationName !== expected.collationName) return false
  return true
}

const RATE_LIMIT_EXPECTED_COLUMNS: Array<Partial<ColumnInfo> & { columnName: string; allowedExtra: string[] }> = [
  { columnName: 'id', columnType: 'varchar(191)', isNullable: 'NO', columnDefault: null, allowedExtra: ['', 'DEFAULT_GENERATED'], characterSetName: 'utf8mb4', collationName: 'utf8mb4_unicode_ci' },
  { columnName: 'key', columnType: 'varchar(191)', isNullable: 'NO', columnDefault: null, allowedExtra: ['', 'DEFAULT_GENERATED'], characterSetName: 'utf8mb4', collationName: 'utf8mb4_unicode_ci' },
  { columnName: 'action', columnType: 'varchar(191)', isNullable: 'NO', columnDefault: null, allowedExtra: ['', 'DEFAULT_GENERATED'], characterSetName: 'utf8mb4', collationName: 'utf8mb4_unicode_ci' },
  { columnName: 'count', columnType: 'int', isNullable: 'NO', columnDefault: '1', allowedExtra: ['', 'DEFAULT_GENERATED'], characterSetName: null, collationName: null },
  { columnName: 'expiresAt', columnType: 'datetime(3)', isNullable: 'NO', columnDefault: null, allowedExtra: ['', 'DEFAULT_GENERATED'], characterSetName: null, collationName: null },
  { columnName: 'createdAt', columnType: 'datetime(3)', isNullable: 'NO', columnDefault: 'current_timestamp(3)', allowedExtra: ['', 'DEFAULT_GENERATED'], characterSetName: null, collationName: null },
]

const RATE_LIMIT_EXPECTED_INDEXES: IndexInfo[] = [
  { indexName: 'PRIMARY', nonUnique: 0, seqInIndex: 1, columnName: 'id', indexType: 'BTREE' },
  { indexName: 'RateLimitLog_expiresAt_idx', nonUnique: 1, seqInIndex: 1, columnName: 'expiresAt', indexType: 'BTREE' },
  { indexName: 'RateLimitLog_key_action_idx', nonUnique: 1, seqInIndex: 1, columnName: 'key', indexType: 'BTREE' },
  { indexName: 'RateLimitLog_key_action_idx', nonUnique: 1, seqInIndex: 2, columnName: 'action', indexType: 'BTREE' },
]

function indexesEquivalent(actual: IndexInfo[], expected: IndexInfo[]): boolean {
  if (actual.length !== expected.length) return false
  return actual.every((row, index) => {
    const target = expected[index]
    return target && row.indexName === target.indexName && row.nonUnique === target.nonUnique && row.seqInIndex === target.seqInIndex && row.columnName === target.columnName && row.indexType === target.indexType
  })
}

function isSuccessfulMigrationRecord(record: MigrationStatus): boolean {
  return Boolean(record.finishedAt && !record.rolledBackAt)
}

function isRolledBackMigrationRecord(record: MigrationStatus): boolean {
  return Boolean(record.rolledBackAt && !record.finishedAt)
}

export function classifyMigrationHistory(
  statuses: MigrationStatus[],
  migrationName: string,
  repositoryChecksum: string | null,
): MigrationHistoryAssessment {
  const records = statuses.filter((record) => record.migrationName === migrationName)
  const successfulRecords = records.filter(isSuccessfulMigrationRecord)
  const rolledBackRecords = records.filter(isRolledBackMigrationRecord)
  const abnormalRecords = records.filter((record) => !isSuccessfulMigrationRecord(record) && !isRolledBackMigrationRecord(record))
  const details: string[] = []

  let status: MigrationHistoryStatus
  let severity: MigrationHistoryAssessment['severity'] = 'NONE'
  if (records.length === 0) {
    status = 'ABSENT'
  } else if (successfulRecords.length > 1 || abnormalRecords.length > 0) {
    status = 'HISTORY_INCONSISTENT'
    severity = 'HIGH'
    if (successfulRecords.length > 1) details.push(`${migrationName} has multiple successful records`)
    if (abnormalRecords.length > 0) details.push(`${migrationName} has non-terminal migration records`)
  } else if (successfulRecords.length === 1) {
    const successfulRecord = successfulRecords[0]
    const repositoryChecksumMatchesProduction = repositoryChecksum !== null && successfulRecord.checksum === repositoryChecksum
    if (!repositoryChecksumMatchesProduction) {
      status = 'CHECKSUM_DRIFT'
      severity = 'HIGH'
      details.push(`${migrationName} successful record checksum differs from the repository migration checksum`)
    } else if (rolledBackRecords.length > 0) {
      status = 'FAILED_THEN_APPLIED'
      details.push(`${migrationName} has rolled-back history followed by one successful record; resolve is not required`)
    } else {
      status = 'APPLIED'
    }
  } else {
    status = 'ROLLED_BACK_ONLY'
    severity = 'HIGH'
    details.push(`${migrationName} has rolled-back records but no successful record`)
  }

  const repositoryChecksumMatchesProduction = successfulRecords.length === 1 && repositoryChecksum !== null
    ? successfulRecords[0].checksum === repositoryChecksum
    : null

  return {
    status,
    records,
    successfulRecords,
    rolledBackRecords,
    repositoryChecksum,
    repositoryChecksumMatchesProduction,
    severity,
    blocking: status === 'ROLLED_BACK_ONLY' || status === 'CHECKSUM_DRIFT' || status === 'HISTORY_INCONSISTENT',
    details,
  }
}

function migrationChecksum(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export async function auditRateLimitLog(db: ReadonlyDatabase): Promise<RateLimitEquivalenceReport> {
  const details: string[] = []
  const migrationState = await getMigrationStatuses(db, [RATE_LIMIT_MIGRATION])
  const repositoryChecksum = migrationChecksum(RATE_LIMIT_MIGRATION_PATH)
  const history = classifyMigrationHistory(migrationState.statuses, RATE_LIMIT_MIGRATION, repositoryChecksum)
  const migrationRecordExists = history.records.length > 0
  const migrationRecordState = history.status === 'ABSENT' ? 'ABSENT' : `${history.status} (records=${history.records.length})`
  const migrationRegistered = history.successfulRecords.length > 0
  if (!migrationState.readable) details.push('_prisma_migrations could not be read')
  details.push(...history.details)
  const table = await getTableInfo(db, 'RateLimitLog')
  if (!table) {
    return {
      history: history.status,
      historySeverity: history.severity,
      repositoryChecksum,
      repositoryChecksumMatchesProduction: history.repositoryChecksumMatchesProduction,
      blocking: !migrationState.readable || history.blocking || migrationRegistered,
      tableExists: false,
      migrationTableReadable: migrationState.readable,
      migrationRecordExists,
      migrationRecordState,
      migrationRegistered,
      columnsEquivalent: false,
      indexesEquivalent: false,
      engineEquivalent: false,
      collationCompatible: false,
      safeToResolve: false,
      details: [...details, 'RateLimitLog table is missing'],
    }
  }

  const columns = await getColumns(db, 'RateLimitLog')
  const indexes = await getIndexes(db, 'RateLimitLog')
  const actualColumns = columns.length === RATE_LIMIT_EXPECTED_COLUMNS.length && RATE_LIMIT_EXPECTED_COLUMNS.every((expected) => {
    const actual = columns.find((column) => column.columnName === expected.columnName)
    return actual ? columnEquivalent(actual, expected) : false
  })
  const actualIndexes = indexesEquivalent(indexes, RATE_LIMIT_EXPECTED_INDEXES)
  const engineEquivalent = table.engine?.toUpperCase() === 'INNODB'
  const collationCompatible = table.tableCollation === 'utf8mb4_unicode_ci'

  if (!actualColumns) details.push('RateLimitLog columns differ from the migration contract')
  if (!actualIndexes) details.push('RateLimitLog indexes differ from the migration contract')
  if (!engineEquivalent) details.push(`RateLimitLog engine is ${table.engine ?? 'NULL'}, expected InnoDB`)
  if (!collationCompatible) details.push(`RateLimitLog table collation is ${table.tableCollation ?? 'NULL'}, expected utf8mb4_unicode_ci`)

  const structureEquivalent = actualColumns && actualIndexes && engineEquivalent && collationCompatible
  const blocking = !migrationState.readable || history.blocking || !structureEquivalent

  return {
    history: history.status,
    historySeverity: history.severity,
    repositoryChecksum,
    repositoryChecksumMatchesProduction: history.repositoryChecksumMatchesProduction,
    blocking,
    tableExists: true,
    migrationTableReadable: migrationState.readable,
    migrationRecordExists,
    migrationRecordState,
    migrationRegistered,
    columnsEquivalent: actualColumns,
    indexesEquivalent: actualIndexes,
    engineEquivalent,
    collationCompatible,
    safeToResolve: migrationState.readable && history.status === 'ABSENT' && structureEquivalent,
    details,
  }
}

function migrationStatusIsApplied(statuses: MigrationStatus[], migrationName: string): boolean {
  return statuses.some((item) => item.migrationName === migrationName && isSuccessfulMigrationRecord(item))
}

function hasMigrationRecord(statuses: MigrationStatus[], migrationName: string): boolean {
  return statuses.some((item) => item.migrationName === migrationName)
}

function describeMigrationRecord(statuses: MigrationStatus[], migrationName: string): string {
  const records = statuses.filter((item) => item.migrationName === migrationName)
  if (records.length === 0) return 'ABSENT'
  const successful = records.filter(isSuccessfulMigrationRecord)
  if (successful.length > 1) return `HISTORY_INCONSISTENT (records=${records.length})`
  if (successful.length === 1) return `APPLIED (steps=${successful[0].appliedStepsCount})`
  if (records.every(isRolledBackMigrationRecord)) return `ROLLED_BACK_ONLY (records=${records.length})`
  return `PRESENT_NOT_APPLIED (records=${records.length})`
}

function hasColumn(columns: ColumnInfo[], columnName: string): boolean {
  return columns.some((column) => column.columnName === columnName)
}

function foreignKeyIsSafe(
  columns: ColumnInfo[],
  foreignKeys: ForeignKeyInfo[],
  columnName: string,
  referencedTableName: string,
  referencedColumnName: string,
): boolean {
  const column = columns.find((item) => item.columnName === columnName)
  const foreignKey = foreignKeys.find((item) => item.columnName === columnName && item.referencedTableName?.toLowerCase() === referencedTableName.toLowerCase() && item.referencedColumnName?.toLowerCase() === referencedColumnName.toLowerCase())
  return Boolean(column && column.isNullable === 'YES' && foreignKey && foreignKey.deleteRule === 'SET NULL')
}

function sameStringColumnType(left: ColumnInfo | undefined, right: ColumnInfo | undefined): boolean {
  if (!left || !right) return false
  return left.columnType === right.columnType && left.characterSetName === right.characterSetName && left.collationName === right.collationName
}

function readHonorMigrationDdl(): HonorMigrationDdlReport {
  const honor = readFileSync(HONOR_MIGRATION_PATH, 'utf8')
  const badgeRule = readFileSync(BADGE_RULE_MIGRATION_PATH, 'utf8')
  const codeAdd = honor.indexOf('ADD COLUMN `code` VARCHAR(191) NULL')
  const codeBackfill = honor.indexOf('UPDATE `Badge`\nSET `code` = `slug`')
  const codeModify = honor.indexOf('MODIFY COLUMN `code` VARCHAR(191) NOT NULL')
  const userBadgeAddObtained = honor.indexOf('ADD COLUMN `obtainedAt` DATETIME(3) NULL')
  const userBadgeAddCreated = honor.indexOf('ADD COLUMN `createdAt` DATETIME(3) NULL')
  const userBadgeBackfill = honor.indexOf('UPDATE `UserBadge`\nSET `obtainedAt` = `grantedAt`,')
  const userBadgeModify = honor.indexOf('MODIFY COLUMN `obtainedAt` DATETIME(3) NOT NULL')
  const userBadgeCreatedModify = honor.indexOf('MODIFY COLUMN `createdAt` DATETIME(3) NOT NULL')
  const grantedByAdd = honor.includes('ADD COLUMN `grantedBy` VARCHAR(191) NULL')
  const grantedByForeignKeySafe = /`UserBadge_grantedBy_fkey`[\s\S]*?`grantedBy`[\s\S]*?REFERENCES `User`\(`id`\)[\s\S]*?ON DELETE SET NULL/i.test(honor)
  const equippedForeignKeySafe = /`User_equippedBadgeId_fkey`[\s\S]*?`equippedBadgeId`[\s\S]*?REFERENCES `Badge`\(`id`\)[\s\S]*?ON DELETE SET NULL/i.test(honor)
  const noAutomaticRuleBackfill = !/INSERT\s+INTO\s+`?BadgeRule`?/i.test(`${honor}\n${badgeRule}`)
  const badgeRuleFields = ['id', 'badgeId', 'ruleType', 'operator', 'threshold', 'secondaryThreshold', 'configJson', 'isEnabled', 'createdAt', 'updatedAt']
  const badgeRuleSchemaSafe = badgeRule.includes('CREATE TABLE `BadgeRule`')
    && badgeRuleFields.every((field) => badgeRule.includes(`\`${field}\``))
    && /UNIQUE INDEX `BadgeRule_badgeId_key`\(`badgeId`\)/i.test(badgeRule)
    && /CONSTRAINT `BadgeRule_badgeId_fkey`[\s\S]*?ON DELETE CASCADE/i.test(badgeRule)

  return {
    codeBackfillOrderSafe: codeAdd >= 0 && codeBackfill > codeAdd && codeModify > codeBackfill,
    userBadgeBackfillOrderSafe: userBadgeAddObtained >= 0 && userBadgeAddCreated >= 0 && userBadgeBackfill > userBadgeAddCreated && userBadgeModify > userBadgeBackfill && userBadgeCreatedModify > userBadgeBackfill,
    equippedBadgeForeignKeySafe: /ADD COLUMN `equippedBadgeId` VARCHAR\(191\) NULL/i.test(honor) && equippedForeignKeySafe,
    grantedByForeignKeySafe: grantedByAdd && grantedByForeignKeySafe,
    badgeRuleSchemaSafe,
    noAutomaticRuleBackfill,
  }
}

async function countQuery(db: ReadonlyDatabase, sql: string): Promise<number | null> {
  const rows = await queryRows<RawRow>(db, sql)
  return asNumber(rows[0] ? Object.values(rows[0])[0] : null)
}

export async function auditHonorBadge(db: ReadonlyDatabase): Promise<HonorBadgePreflightReport> {
  const details: string[] = []
  const ddl = readHonorMigrationDdl()
  const baseTableNames = ['Badge', 'User', 'UserBadge']
  const baseTables = await Promise.all(baseTableNames.map(async (tableName) => ({ tableName, info: await getTableInfo(db, tableName) })))
  const baseTablesPresent = baseTables.every((item) => item.info)
  const migrationState = await getMigrationStatuses(db, [RATE_LIMIT_MIGRATION, HONOR_BADGE_MIGRATION, BADGE_RULE_MIGRATION])
  const migrationRecordExists = hasMigrationRecord(migrationState.statuses, HONOR_BADGE_MIGRATION)
  const migrationRecordState = describeMigrationRecord(migrationState.statuses, HONOR_BADGE_MIGRATION)
  const migrationRegistered = migrationStatusIsApplied(migrationState.statuses, HONOR_BADGE_MIGRATION)

  if (!baseTablesPresent) details.push('Badge, User and UserBadge must all exist before the Honor Badge migration')
  if (!migrationState.readable) details.push('_prisma_migrations could not be read')
  if (migrationRegistered) details.push(`${HONOR_BADGE_MIGRATION} is already marked applied`)
  if (migrationRecordExists && !migrationRegistered) details.push(`${HONOR_BADGE_MIGRATION} has a non-applied _prisma_migrations row`)

  const badgeColumns = baseTablesPresent ? await getColumns(db, 'Badge') : []
  const userColumns = baseTablesPresent ? await getColumns(db, 'User') : []
  const userBadgeColumns = baseTablesPresent ? await getColumns(db, 'UserBadge') : []
  const targetColumns = [
    ['Badge', ['code', 'acquisitionDescription', 'visibility', 'rarity', 'grantType', 'isWearable', 'isEnabled', 'effectType', 'nicknameEffect', 'nicknameColor', 'nicknameGradientStart', 'nicknameGradientEnd', 'sortOrder']],
    ['User', ['equippedBadgeId']],
    ['UserBadge', ['obtainedAt', 'sourceType', 'sourceId', 'grantReason', 'grantedBy', 'createdAt']],
  ] as const
  const targetColumnsAbsent = targetColumns.every(([tableName, columns]) => {
    const actual = tableName === 'Badge' ? badgeColumns : tableName === 'User' ? userColumns : userBadgeColumns
    return columns.every((columnName) => !hasColumn(actual, columnName))
  })
  const targetColumnsPresent = targetColumns.every(([tableName, columns]) => {
    const actual = tableName === 'Badge' ? badgeColumns : tableName === 'User' ? userColumns : userBadgeColumns
    return columns.every((columnName) => hasColumn(actual, columnName))
  })
  if (!targetColumnsAbsent && !targetColumnsPresent) details.push('Honor Badge target columns are only partially present')
  if (!migrationRegistered && !targetColumnsAbsent) details.push('One or more Honor Badge target columns already exist; the migration is not a clean pending migration')
  if (migrationRegistered && !targetColumnsPresent) details.push('Honor Badge is marked applied but its target columns are incomplete')

  const badgeData: HonorBadgePreflightReport['badgeData'] = {
    total: null,
    nonNullSlug: null,
    distinctSlug: null,
    nonNullCode: null,
    distinctCode: null,
    codeMismatchCount: null,
    duplicateSlugCount: null,
    blankSlugCount: null,
    untrimmedSlugCount: null,
    caseInsensitiveDuplicateCount: null,
    slugCollation: null,
  }
  const userBadgeData: HonorBadgePreflightReport['userBadgeData'] = { total: null, grantedAtNonNull: null, obtainedAtNonNull: null, createdAtNonNull: null }

  if (baseTablesPresent) {
    const slugColumn = badgeColumns.find((column) => column.columnName === 'slug')
    badgeData.slugCollation = slugColumn?.collationName ?? null
    const badgeStatsSql = hasColumn(badgeColumns, 'code')
      ? 'SELECT COUNT(*) AS total, COUNT(`slug`) AS nonNullSlug, COUNT(DISTINCT `slug`) AS distinctSlug, COUNT(`code`) AS nonNullCode, COUNT(DISTINCT `code`) AS distinctCode FROM `Badge`'
      : 'SELECT COUNT(*) AS total, COUNT(`slug`) AS nonNullSlug, COUNT(DISTINCT `slug`) AS distinctSlug FROM `Badge`'
    const stats = await queryRows<RawRow>(db, badgeStatsSql)
    badgeData.total = asNumber(stats[0]?.total)
    badgeData.nonNullSlug = asNumber(stats[0]?.nonNullSlug)
    badgeData.distinctSlug = asNumber(stats[0]?.distinctSlug)
    badgeData.nonNullCode = asNumber(stats[0]?.nonNullCode)
    badgeData.distinctCode = asNumber(stats[0]?.distinctCode)
    if (hasColumn(badgeColumns, 'code')) {
      badgeData.codeMismatchCount = await countQuery(db, 'SELECT COUNT(*) AS mismatchCount FROM `Badge` WHERE NOT (`code` <=> `slug`)')
    }
    badgeData.duplicateSlugCount = await countQuery(db, 'SELECT COUNT(*) AS duplicateGroups FROM (SELECT `slug` FROM `Badge` WHERE `slug` IS NOT NULL GROUP BY `slug` HAVING COUNT(*) > 1) duplicates')
    badgeData.blankSlugCount = await countQuery(db, 'SELECT COUNT(*) AS blankCount FROM `Badge` WHERE `slug` IS NULL OR TRIM(`slug`) = \'\'')
    badgeData.untrimmedSlugCount = await countQuery(db, 'SELECT COUNT(*) AS untrimmedCount FROM `Badge` WHERE `slug` IS NOT NULL AND `slug` <> TRIM(`slug`)')
    badgeData.caseInsensitiveDuplicateCount = await countQuery(db, 'SELECT COUNT(*) AS duplicateGroups FROM (SELECT LOWER(TRIM(`slug`)) AS normalizedSlug FROM `Badge` WHERE `slug` IS NOT NULL AND TRIM(`slug`) <> \'\' GROUP BY LOWER(TRIM(`slug`)) HAVING COUNT(*) > 1) duplicates')
    const userBadgeStatsSql = hasColumn(userBadgeColumns, 'obtainedAt') && hasColumn(userBadgeColumns, 'createdAt')
      ? 'SELECT COUNT(*) AS total, COUNT(`grantedAt`) AS grantedAtNonNull, COUNT(`obtainedAt`) AS obtainedAtNonNull, COUNT(`createdAt`) AS createdAtNonNull FROM `UserBadge`'
      : 'SELECT COUNT(*) AS total, COUNT(`grantedAt`) AS grantedAtNonNull FROM `UserBadge`'
    const userBadgeStats = await queryRows<RawRow>(db, userBadgeStatsSql)
    userBadgeData.total = asNumber(userBadgeStats[0]?.total)
    userBadgeData.grantedAtNonNull = asNumber(userBadgeStats[0]?.grantedAtNonNull)
    userBadgeData.obtainedAtNonNull = asNumber(userBadgeStats[0]?.obtainedAtNonNull)
    userBadgeData.createdAtNonNull = asNumber(userBadgeStats[0]?.createdAtNonNull)
  }

  const badgeDataSafe = badgeData.total !== null
    && badgeData.nonNullSlug === badgeData.total
    && badgeData.distinctSlug === badgeData.total
    && badgeData.duplicateSlugCount === 0
    && badgeData.blankSlugCount === 0
    && badgeData.untrimmedSlugCount === 0
    && badgeData.caseInsensitiveDuplicateCount === 0
    && Boolean(badgeData.slugCollation)
  const codeDataSafe = !migrationRegistered || (badgeData.nonNullCode === badgeData.total && badgeData.distinctCode === badgeData.total && badgeData.codeMismatchCount === 0)
  const userBadgeDataSafe = userBadgeData.total !== null
    && userBadgeData.grantedAtNonNull === userBadgeData.total
    && (!migrationRegistered || (userBadgeData.obtainedAtNonNull === userBadgeData.total && userBadgeData.createdAtNonNull === userBadgeData.total))
  if (!badgeDataSafe) details.push('Badge.slug is not safe for code backfill and UNIQUE(code) under the current MySQL collation')
  if (!codeDataSafe) details.push('Badge.code contains NULL, duplicate, or slug-mismatched values after the Honor Badge migration')
  if (!userBadgeDataSafe) details.push('UserBadge.grantedAt contains NULL values or could not be checked')

  const userForeignKeys = baseTablesPresent ? await getForeignKeys(db, 'User') : []
  const userBadgeForeignKeys = baseTablesPresent ? await getForeignKeys(db, 'UserBadge') : []
  const equippedAlreadyPresent = hasColumn(userColumns, 'equippedBadgeId')
  const grantedByAlreadyPresent = hasColumn(userBadgeColumns, 'grantedBy')
  const equippedRuntimeSafe = !equippedAlreadyPresent || (foreignKeyIsSafe(userColumns, userForeignKeys, 'equippedBadgeId', 'Badge', 'id') && sameStringColumnType(userColumns.find((column) => column.columnName === 'equippedBadgeId'), badgeColumns.find((column) => column.columnName === 'id')))
  const grantedByRuntimeSafe = !grantedByAlreadyPresent || (foreignKeyIsSafe(userBadgeColumns, userBadgeForeignKeys, 'grantedBy', 'User', 'id') && sameStringColumnType(userBadgeColumns.find((column) => column.columnName === 'grantedBy'), userColumns.find((column) => column.columnName === 'id')))
  if (!equippedRuntimeSafe) {
    const column = userColumns.find((item) => item.columnName === 'equippedBadgeId')
    const keys = userForeignKeys.filter((item) => item.columnName === 'equippedBadgeId')
    details.push(`Existing User.equippedBadgeId is not nullable/type-compatible/SET NULL (nullable=${column?.isNullable ?? 'MISSING'}, type=${column?.columnType ?? 'MISSING'}, foreignKeys=${JSON.stringify(keys)})`)
  }
  if (!grantedByRuntimeSafe) {
    const column = userBadgeColumns.find((item) => item.columnName === 'grantedBy')
    const keys = userBadgeForeignKeys.filter((item) => item.columnName === 'grantedBy')
    details.push(`Existing UserBadge.grantedBy is not nullable/type-compatible/SET NULL (nullable=${column?.isNullable ?? 'MISSING'}, type=${column?.columnType ?? 'MISSING'}, foreignKeys=${JSON.stringify(keys)})`)
  }

  const badgeRuleTable = await getTableInfo(db, 'BadgeRule')
  const badgeRuleMigrationApplied = migrationStatusIsApplied(migrationState.statuses, BADGE_RULE_MIGRATION)
  let badgeRuleRuntimeSafe = true
  let badgeRuleRuntimeState = badgeRuleMigrationApplied ? 'APPLIED_BUT_TABLE_MISSING' : 'NOT_APPLIED_YET'
  if (badgeRuleTable) {
    const badgeRuleColumns = await getColumns(db, 'BadgeRule')
    const badgeRuleIndexes = await getIndexes(db, 'BadgeRule')
    const badgeRuleForeignKeys = await getForeignKeys(db, 'BadgeRule')
    const requiredBadgeRuleColumns = ['id', 'badgeId', 'ruleType', 'operator', 'threshold', 'secondaryThreshold', 'configJson', 'isEnabled', 'createdAt', 'updatedAt']
    const columnsSafe = requiredBadgeRuleColumns.every((columnName) => hasColumn(badgeRuleColumns, columnName))
    const uniqueBadgeId = badgeRuleIndexes.some((index) => index.indexName === 'BadgeRule_badgeId_key' && index.nonUnique === 0 && index.seqInIndex === 1 && index.columnName === 'badgeId')
    const foreignKeySafe = badgeRuleForeignKeys.some((foreignKey) => foreignKey.columnName === 'badgeId' && foreignKey.referencedTableName?.toLowerCase() === 'badge' && foreignKey.referencedColumnName?.toLowerCase() === 'id' && foreignKey.deleteRule === 'CASCADE')
    badgeRuleRuntimeSafe = badgeRuleMigrationApplied && columnsSafe && uniqueBadgeId && foreignKeySafe
    badgeRuleRuntimeState = badgeRuleRuntimeSafe ? 'APPLIED_AND_VALID' : 'PRESENT_BUT_INVALID_OR_UNREGISTERED'
  } else if (badgeRuleMigrationApplied) {
    badgeRuleRuntimeSafe = false
  }
  if (!badgeRuleRuntimeSafe) details.push(`BadgeRule runtime state is ${badgeRuleRuntimeState}`)

  let birthdayAutoCompatibility = 'grantType is not present before Honor Badge; no AUTO rows can be rewritten by this migration.'
  if (hasColumn(badgeColumns, 'grantType')) {
    if (!badgeRuleTable) {
      birthdayAutoCompatibility = 'Legacy AUTO badge rows may exist without BadgeRule; this migration contains no BadgeRule backfill and leaves birthday service ownership intact.'
    } else {
      const autoWithoutRule = await countQuery(db, 'SELECT COUNT(*) AS autoWithoutRule FROM `Badge` b LEFT JOIN `BadgeRule` r ON r.`badgeId` = b.`id` WHERE b.`grantType` = \'AUTO\' AND r.`id` IS NULL')
      birthdayAutoCompatibility = `Existing AUTO badges without BadgeRule: ${autoWithoutRule ?? 'UNKNOWN'}; no automatic rule insertion is performed.`
    }
  }

  const safe = migrationState.readable
    && baseTablesPresent
    && (!migrationRecordExists || migrationRegistered)
    && (migrationRegistered ? targetColumnsPresent : targetColumnsAbsent)
    && badgeDataSafe
    && codeDataSafe
    && userBadgeDataSafe
    && ddl.codeBackfillOrderSafe
    && ddl.userBadgeBackfillOrderSafe
    && ddl.equippedBadgeForeignKeySafe
    && ddl.grantedByForeignKeySafe
    && ddl.badgeRuleSchemaSafe
    && badgeRuleRuntimeSafe
    && ddl.noAutomaticRuleBackfill
    && equippedRuntimeSafe
    && grantedByRuntimeSafe

  return {
    status: safe ? 'SAFE_TO_DEPLOY' : 'NOT_SAFE_TO_DEPLOY',
    migrationTableReadable: migrationState.readable,
    migrationRecordExists,
    migrationRecordState,
    migrationRegistered,
    baseTablesPresent,
    targetColumnsAbsent,
    targetColumnsPresent,
    badgeData,
    userBadgeData,
    ddl: {
      ...ddl,
      badgeRuleSchemaSafe: ddl.badgeRuleSchemaSafe && badgeRuleRuntimeSafe,
      equippedBadgeForeignKeySafe: ddl.equippedBadgeForeignKeySafe && equippedRuntimeSafe,
      grantedByForeignKeySafe: ddl.grantedByForeignKeySafe && grantedByRuntimeSafe,
    },
    badgeRuleRuntimeState,
    birthdayAutoCompatibility,
    details,
  }
}

function loadProjectEnv() {
  const envPath = path.resolve(PROJECT_ROOT, '.env')
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
}

function parseArgs() {
  const args = new Set(process.argv.slice(2))
  return {
    productionReadonly: args.has('--production-readonly'),
  }
}

function selectedDatabaseUrl(): string | null {
  return process.env.MIGRATION_PREFLIGHT_DATABASE_URL ?? process.env.MIGRATION_MYSQL_URL ?? process.env.DATABASE_URL ?? null
}

function redact(value: string, secret: string | null): string {
  return secret ? value.replaceAll(secret, '<redacted-database-url>') : value
}

function runPnpm(args: string[], env?: NodeJS.ProcessEnv): { ok: boolean; output: string } {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm', ...args] : args
  try {
    const output = execFileSync(command, commandArgs, { cwd: PROJECT_ROOT, env: env ?? process.env, encoding: 'utf8', stdio: 'pipe' })
    return { ok: true, output }
  } catch (error) {
    const output = error && typeof error === 'object' && 'stdout' in error
      ? String((error as { stdout?: unknown }).stdout ?? '')
      : ''
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '')
      : String(error)
    const message = error instanceof Error ? error.message : String(error)
    const combined = `${output}${stderr}`
    return { ok: false, output: combined || message }
  }
}

function runFormatCheck(): { ok: boolean; output: string } {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'eason-migration-format-'))
  const tempSchema = path.resolve(tempRoot, 'schema.prisma')
  try {
    copyFileSync(SCHEMA_PATH, tempSchema)
    const result = runPnpm(['exec', 'prisma', 'format', '--schema', tempSchema])
    if (!result.ok) return result
    const original = readFileSync(SCHEMA_PATH, 'utf8').replaceAll('\r\n', '\n')
    const formatted = readFileSync(tempSchema, 'utf8').replaceAll('\r\n', '\n')
    return original === formatted
      ? { ok: true, output: 'Prisma format check: PASS' }
      : { ok: false, output: 'Prisma format check: FAIL (schema differs from Prisma formatter output)' }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function printRateLimitReport(report: RateLimitEquivalenceReport) {
  console.log('RateLimitLog production equivalence')
  console.log(`History: ${report.history}`)
  console.log(`History severity: ${report.historySeverity}`)
  console.log(`Repository checksum: ${report.repositoryChecksum}`)
  console.log(`Repository checksum match: ${report.repositoryChecksumMatchesProduction === null ? 'UNKNOWN' : report.repositoryChecksumMatchesProduction ? 'YES' : 'NO'}`)
  console.log(`Table exists: ${report.tableExists ? 'YES' : 'NO'}`)
  console.log(`Migration record: ${report.migrationRecordState}`)
  console.log(`Migration registered: ${report.migrationRegistered ? 'YES' : 'NO'}`)
  console.log(`Columns equivalent: ${report.columnsEquivalent ? 'YES' : 'NO'}`)
  console.log(`Indexes equivalent: ${report.indexesEquivalent ? 'YES' : 'NO'}`)
  console.log(`Engine equivalent: ${report.engineEquivalent ? 'YES' : 'NO'}`)
  console.log(`Collation compatible: ${report.collationCompatible ? 'YES' : 'NO'}`)
  console.log(`Production structure equivalent: ${report.columnsEquivalent && report.indexesEquivalent && report.engineEquivalent && report.collationCompatible ? 'YES' : 'NO'}`)
  console.log(`Blocking: ${report.blocking ? 'YES' : 'NO'}`)
  console.log(`Safe candidate for resolve --applied: ${report.safeToResolve ? 'YES' : 'NO'}`)
  for (const detail of report.details) console.log(`  - ${detail}`)
}

function printHonorReport(report: HonorBadgePreflightReport) {
  console.log('Honor Badge production preflight')
  console.log(`Migration record: ${report.migrationRecordState}`)
  console.log(`Migration registered: ${report.migrationRegistered ? 'YES' : 'NO'}`)
  console.log(`Base tables present: ${report.baseTablesPresent ? 'YES' : 'NO'}`)
  console.log(`Target columns absent: ${report.targetColumnsAbsent ? 'YES' : 'NO'}`)
  console.log(`Target columns present: ${report.targetColumnsPresent ? 'YES' : 'NO'}`)
  console.log(`Badge rows: ${report.badgeData.total ?? 'UNKNOWN'}`)
  console.log(`Badge slug non-null: ${report.badgeData.nonNullSlug ?? 'UNKNOWN'}`)
  console.log(`Badge slug distinct: ${report.badgeData.distinctSlug ?? 'UNKNOWN'}`)
  console.log(`Badge code non-null: ${report.badgeData.nonNullCode ?? 'NOT_APPLICABLE'}`)
  console.log(`Badge code distinct: ${report.badgeData.distinctCode ?? 'NOT_APPLICABLE'}`)
  console.log(`Badge code/slug mismatches: ${report.badgeData.codeMismatchCount ?? 'NOT_APPLICABLE'}`)
  console.log(`Duplicate slug groups: ${report.badgeData.duplicateSlugCount ?? 'UNKNOWN'}`)
  console.log(`Blank slug rows: ${report.badgeData.blankSlugCount ?? 'UNKNOWN'}`)
  console.log(`Untrimmed slug rows: ${report.badgeData.untrimmedSlugCount ?? 'UNKNOWN'}`)
  console.log(`Case-insensitive duplicate groups: ${report.badgeData.caseInsensitiveDuplicateCount ?? 'UNKNOWN'}`)
  console.log(`Badge.slug collation: ${report.badgeData.slugCollation ?? 'UNKNOWN'}`)
  console.log(`UserBadge rows: ${report.userBadgeData.total ?? 'UNKNOWN'}`)
  console.log(`UserBadge grantedAt non-null: ${report.userBadgeData.grantedAtNonNull ?? 'UNKNOWN'}`)
  console.log(`UserBadge obtainedAt non-null: ${report.userBadgeData.obtainedAtNonNull ?? 'NOT_APPLICABLE'}`)
  console.log(`UserBadge createdAt non-null: ${report.userBadgeData.createdAtNonNull ?? 'NOT_APPLICABLE'}`)
  console.log(`DDL code backfill order: ${report.ddl.codeBackfillOrderSafe ? 'SAFE' : 'UNSAFE'}`)
  console.log(`DDL UserBadge backfill order: ${report.ddl.userBadgeBackfillOrderSafe ? 'SAFE' : 'UNSAFE'}`)
  console.log(`equippedBadgeId FK: ${report.ddl.equippedBadgeForeignKeySafe ? 'SAFE' : 'UNSAFE'}`)
  console.log(`grantedBy FK: ${report.ddl.grantedByForeignKeySafe ? 'SAFE' : 'UNSAFE'}`)
  console.log(`BadgeRule schema: ${report.ddl.badgeRuleSchemaSafe ? 'SAFE' : 'UNSAFE'}`)
  console.log(`BadgeRule runtime: ${report.badgeRuleRuntimeState}`)
  console.log(`Automatic BadgeRule backfill: ${report.ddl.noAutomaticRuleBackfill ? 'NONE' : 'FOUND'}`)
  console.log(`Birthday AUTO compatibility: ${report.birthdayAutoCompatibility}`)
  for (const detail of report.details) console.log(`  - ${detail}`)
  console.log(`HONOR_BADGE_STATUS = ${report.status}`)
}

function printStaticFindings(findings: MigrationFinding[], label: string) {
  if (!findings.length) {
    console.log(`${label}: PASS`)
    return true
  }
  for (const finding of findings) console.log(`[${finding.severity}] ${finding.code}: ${finding.message}`)
  return !findings.some((finding) => finding.severity === 'ERROR')
}

async function runProductionReadonly(databaseUrl: string) {
  if (!databaseUrl.startsWith('mysql:')) throw new Error('Production readonly preflight requires a MySQL DATABASE_URL')
  const entryPath = existsSync(MYSQL_RAW_CLIENT_PATH) ? MYSQL_RAW_CLIENT_PATH : ensureGeneratedClient('mysql')
  const { PrismaClient } = await import(pathToFileURL(entryPath).href)
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl, log: ['error'] }) as unknown as ReadonlyDatabase
  try {
    const rateLimit = await auditRateLimitLog(prisma)
    const honor = await auditHonorBadge(prisma)
    printRateLimitReport(rateLimit)
    printHonorReport(honor)
    return {
      rateLimit,
      honor,
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  loadProjectEnv()
  const { productionReadonly } = parseArgs()
  const staticResult = runMigrationMysqlCheck(PROJECT_ROOT)
  console.log(formatMigrationCheck(staticResult))

  const validate = runPnpm(['exec', 'prisma', 'validate', '--schema', SCHEMA_PATH])
  console.log(validate.output.trim() || `Prisma validate: ${validate.ok ? 'PASS' : 'FAIL'}`)
  const format = runFormatCheck()
  console.log(format.output.trim())

  const baselineReport = auditBaselineFile()
  console.log(formatBaselineAudit(baselineReport))
  let baselineStatic = baselineReport.passed
  if (baselineReport.generated) {
    const baselineInspection = inspectMigrationSql('baseline-draft/0_init_baseline', readFileSync(auditBaselineFile().generated ? path.resolve(PROJECT_ROOT, 'prisma/baseline-draft/0_init_baseline/migration.sql') : '', 'utf8'))
    baselineStatic = baselineStatic && printStaticFindings(baselineInspection.findings, 'Baseline draft MySQL SQL static check')
  }

  if (!productionReadonly) {
    console.log('Production readonly audit: SKIPPED (pass --production-readonly explicitly to enable database reads)')
    console.log('RATE_LIMIT_LOG_STATUS = SKIPPED')
    console.log('HONOR_BADGE_STATUS = SKIPPED')
    process.exitCode = staticResult.passed && validate.ok && format.ok && baselineStatic ? 0 : 1
    return
  }

  const databaseUrl = selectedDatabaseUrl()
  if (!databaseUrl) throw new Error('Missing MySQL URL; set MIGRATION_PREFLIGHT_DATABASE_URL or MIGRATION_MYSQL_URL for --production-readonly')
  const status = runPnpm(['exec', 'prisma', 'migrate', 'status', '--schema', SCHEMA_PATH], { ...process.env, DATABASE_URL: databaseUrl })
  console.log(redact(status.output.trim(), databaseUrl))
  const migrationStatusReadable = status.ok || /migrations found|following migration have not yet been applied|database schema is up to date/i.test(status.output)

  try {
    const production = await runProductionReadonly(databaseUrl)
    process.exitCode = staticResult.passed && validate.ok && format.ok && baselineStatic && migrationStatusReadable && !production.rateLimit.blocking && production.honor.status === 'SAFE_TO_DEPLOY' ? 0 : 1
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : String(error), databaseUrl))
    console.log('RATE_LIMIT_LOG_STATUS = NOT_SAFE_TO_RESOLVE')
    console.log('HONOR_BADGE_STATUS = NOT_SAFE_TO_DEPLOY')
    process.exitCode = 1
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
