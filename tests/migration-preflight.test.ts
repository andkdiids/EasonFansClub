import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { classifyMigrationHistory } from '../scripts/migration-preflight'
import { inspectMigrationSql } from '../scripts/check-migrations-mysql'
import type { MigrationStatus } from '../scripts/migration-preflight'

const RATE_LIMIT_MIGRATION = '20260821120000_add_rate_limit_log'
const REPOSITORY_CHECKSUM = 'dc50e8b04ecfd93ed3d11127879059296c616fa0baf253afd7efe4a3c4a22867'

function migrationRecord(overrides: Partial<MigrationStatus>): MigrationStatus {
  return {
    id: overrides.id ?? randomUUID(),
    migrationName: overrides.migrationName ?? RATE_LIMIT_MIGRATION,
    checksum: overrides.checksum ?? REPOSITORY_CHECKSUM,
    startedAt: overrides.startedAt ?? '2026-08-21T11:43:17.967Z',
    finishedAt: overrides.finishedAt ?? null,
    rolledBackAt: overrides.rolledBackAt ?? null,
    appliedStepsCount: overrides.appliedStepsCount ?? 0,
    logs: overrides.logs ?? null,
  }
}

test('RateLimitLog failed-only history blocks as ROLLED_BACK_ONLY', () => {
  const history = classifyMigrationHistory([
    migrationRecord({ rolledBackAt: '2026-08-21T15:37:57.107Z' }),
  ], RATE_LIMIT_MIGRATION, REPOSITORY_CHECKSUM)

  assert.equal(history.status, 'ROLLED_BACK_ONLY')
  assert.equal(history.blocking, true)
  assert.equal(history.severity, 'HIGH')
})

test('RateLimitLog failed then applied history passes without resolve', () => {
  const history = classifyMigrationHistory([
    migrationRecord({ rolledBackAt: '2026-08-21T15:37:57.107Z' }),
    migrationRecord({
      id: 'successful-record',
      startedAt: '2026-08-21T15:37:57.122Z',
      finishedAt: '2026-08-21T15:37:57.122Z',
    }),
  ], RATE_LIMIT_MIGRATION, REPOSITORY_CHECKSUM)

  assert.equal(history.status, 'FAILED_THEN_APPLIED')
  assert.equal(history.repositoryChecksumMatchesProduction, true)
  assert.equal(history.blocking, false)
})

test('RateLimitLog applied checksum drift is reported as CHECKSUM_DRIFT', () => {
  const history = classifyMigrationHistory([
    migrationRecord({ finishedAt: '2026-08-21T15:37:57.122Z', checksum: 'different-checksum' }),
  ], RATE_LIMIT_MIGRATION, REPOSITORY_CHECKSUM)

  assert.equal(history.status, 'CHECKSUM_DRIFT')
  assert.equal(history.repositoryChecksumMatchesProduction, false)
  assert.equal(history.severity, 'HIGH')
  assert.equal(history.blocking, true)
})

test('RateLimitLog multiple successful records are HISTORY_INCONSISTENT', () => {
  const history = classifyMigrationHistory([
    migrationRecord({ finishedAt: '2026-08-21T15:37:57.122Z' }),
    migrationRecord({ id: 'second-success', finishedAt: '2026-08-21T15:38:01.122Z' }),
  ], RATE_LIMIT_MIGRATION, REPOSITORY_CHECKSUM)

  assert.equal(history.status, 'HISTORY_INCONSISTENT')
  assert.equal(history.blocking, true)
  assert.equal(history.severity, 'HIGH')
})

test('migration preflight does not flag unrelated CHECK and foreign-key columns', () => {
  const inspection = inspectMigrationSql('20260815090000_add_song_ratings', `
    CREATE TABLE \`Rating\` (
      \`score\` INTEGER NOT NULL,
      CHECK (\`score\` BETWEEN 1 AND 10)
    );
    ALTER TABLE \`Rating\`
      ADD CONSTRAINT \`Rating_userId_fkey\`
      FOREIGN KEY (\`userId\`) REFERENCES \`User\`(\`id\`) ON DELETE RESTRICT;
  `)
  assert.equal(inspection.findings.some((finding) => finding.code === 'MYSQL_3823_RISK'), false)
})

test('migration preflight flags a CHECK that covers a foreign-key column', () => {
  const inspection = inspectMigrationSql('20260822000000_same_column_check', `
    CREATE TABLE \`Child\` (
      \`parentId\` VARCHAR(191) NOT NULL,
      CHECK (\`parentId\` <> '')
    );
    ALTER TABLE \`Child\`
      ADD CONSTRAINT \`Child_parentId_fkey\`
      FOREIGN KEY (\`parentId\`) REFERENCES \`Parent\`(\`id\`) ON DELETE CASCADE;
  `)
  assert.equal(inspection.findings.some((finding) => finding.code === 'MYSQL_3823_RISK'), true)
})
