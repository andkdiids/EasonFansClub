import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '@/lib/prisma'

const MIGRATION_NAME = '20261111120000_add_instagram_lease_generation'

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
  return message.replace(/(?:mysql|postgresql|postgres):\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]').slice(0, 300)
}

async function main() {
  const phase = process.argv[2]
  if (phase !== 'before' && phase !== 'after') throw new Error('INVALID_MIGRATION_CHECK_PHASE')

  const migrationPath = resolve('prisma/migrations', MIGRATION_NAME, 'migration.sql')
  const migration = await readFile(migrationPath)
  const checksum = createHash('sha256').update(migration).digest('hex')
  const stateTables = await prisma.$queryRaw<Array<{ tableName: string }>>`
    SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SocialSyncState'
  `
  if (stateTables.length !== 1) throw new Error('SOCIAL_SYNC_STATE_TABLE_MISSING')

  const stateColumns = await prisma.$queryRaw<Array<{ columnName: string; columnType: string; nullable: string; defaultValue: string | null }>>`
    SELECT COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SocialSyncState'
  `
  const columns = new Map(stateColumns.map((column) => [column.columnName, column]))
  for (const requiredColumn of ['id', 'platform', 'target', 'lockToken', 'lockUntil']) {
    if (!columns.has(requiredColumn)) throw new Error(`SOCIAL_SYNC_STATE_LEGACY_COLUMN_MISSING:${requiredColumn}`)
  }
  const generation = columns.get('leaseGeneration')
  if (generation && (generation.columnType.toLowerCase() !== 'bigint' || generation.nullable !== 'NO' || String(generation.defaultValue) !== '0')) {
    throw new Error('LEASE_GENERATION_COLUMN_SHAPE_MISMATCH')
  }

  const ledgerTable = await prisma.$queryRaw<Array<{ tableName: string }>>`
    SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '_prisma_migrations'
  `
  if (ledgerTable.length !== 1) throw new Error('PRISMA_MIGRATION_LEDGER_MISSING')
  const attempts = await prisma.$queryRaw<Array<{
    checksum: string
    startedAt: Date
    finishedAt: Date | null
    rolledBackAt: Date | null
  }>>`
    SELECT checksum, started_at AS startedAt, finished_at AS finishedAt, rolled_back_at AS rolledBackAt
    FROM _prisma_migrations WHERE migration_name = ${MIGRATION_NAME}
    ORDER BY started_at DESC
  `
  if (attempts.some((attempt) => attempt.checksum !== checksum)) throw new Error('LEASE_GENERATION_MIGRATION_CHECKSUM_MISMATCH')
  const latest = attempts[0]
  const applied = Boolean(latest?.finishedAt && !latest.rolledBackAt)

  if (phase === 'before') {
    if (applied !== Boolean(generation)) throw new Error('LEASE_GENERATION_SCHEMA_LEDGER_DIVERGENCE')
    if (latest && !latest.finishedAt && !latest.rolledBackAt) throw new Error('LEASE_GENERATION_MIGRATION_ATTEMPT_INCOMPLETE')
    process.stdout.write(`LEASE_GENERATION_MIGRATION_BEFORE=${applied ? 'ALREADY_APPLIED' : 'PENDING'}\n`)
    process.stdout.write(`LEASE_GENERATION_COLUMN_BEFORE=${generation ? 'PRESENT' : 'ABSENT'}\n`)
    return
  }

  if (!applied || !generation) throw new Error('LEASE_GENERATION_MIGRATION_NOT_APPLIED')
  process.stdout.write('LEASE_GENERATION_MIGRATION_AFTER=APPLIED\n')
  process.stdout.write('LEASE_GENERATION_MIGRATION_LEDGER=VERIFIED\n')
  process.stdout.write('LEASE_GENERATION_COLUMN_SHAPE=VERIFIED\n')
}

void main().catch(async (error) => {
  process.stderr.write(`LEASE_GENERATION_MIGRATION_CHECK_FAILED=${safeError(error)}\n`)
  process.exitCode = 1
}).finally(async () => {
  await prisma.$disconnect().catch(() => undefined)
})
