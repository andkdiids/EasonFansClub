import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { inspectMigrationSql } from '../scripts/check-migrations-mysql'

const socialPostsMigrationPath = path.resolve(__dirname, '..', 'prisma', 'migrations', '20260826100000_add_anywhere_door_social_posts', 'migration.sql')
const safetyStateMigrationPath = path.resolve(__dirname, '..', 'prisma', 'migrations', '20260827100000_add_anywhere_door_safety_state', 'migration.sql')

function readCandidate() {
  // Reproducible test fixture, not a recovered production deployment artifact.
  // Keep the tracked migrations unchanged and in their migration-chain order.
  // The old ignored tmp SQL file is unavailable on a clean checkout.
  return [socialPostsMigrationPath, safetyStateMigrationPath]
    .map((migrationPath) => readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n').trimEnd())
    .join('\n\n') + '\n'
}

test('incremental candidate fixture follows the tracked migration order without an ignored artifact', () => {
  const sql = readCandidate()
  assert.deepEqual(inspectMigrationSql('20260827100000_reproducible_candidate_fixture', sql).findings, [])
  const createLog = sql.indexOf('CREATE TABLE `SocialSyncLog`')
  const extendLog = sql.indexOf('ALTER TABLE `SocialSyncLog`')
  const createState = sql.indexOf('CREATE TABLE `SocialSyncState`')
  assert.ok(createLog >= 0 && extendLog > createLog && createState > extendLog)
})

test('Anywhere Door migrations are MySQL-safe and include the persistent safety state', () => {
  const socialPostsMigration = readFileSync(socialPostsMigrationPath, 'utf8')
  const safetyStateMigration = readFileSync(safetyStateMigrationPath, 'utf8')
  assert.deepEqual(inspectMigrationSql('20260826100000_add_anywhere_door_social_posts', socialPostsMigration).findings, [])
  assert.deepEqual(inspectMigrationSql('20260827100000_add_anywhere_door_safety_state', safetyStateMigration).findings, [])
  assert.match(socialPostsMigration, /CREATE TABLE `SocialPost`/)
  assert.match(safetyStateMigration, /ALTER TABLE `SocialSyncLog`[\s\S]*`notificationCount`/)
  assert.match(safetyStateMigration, /CREATE TABLE `SocialSyncState`/)
})

test('production incremental candidate is scoped to Anywhere Door tables', () => {
  const sql = readCandidate()
  const tables = [...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((match) => match[1])
  assert.deepEqual(tables, [
    'SocialPost',
    'SocialPostMedia',
    'SocialPostLike',
    'SocialPostComment',
    'SocialSyncLog',
    'SocialSyncState',
  ])
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i)
  assert.doesNotMatch(sql, /TRUNCATE\b|RENAME\s+TABLE\b|\bDELETE\s+FROM\b|\bUPDATE\s+`/i)
  assert.doesNotMatch(sql, /ALTER TABLE `(?!SocialPost(?:Media|Like|Comment)?`|SocialSyncLog`|SocialSyncState`)/i)
})

test('production incremental candidate includes current safety state and log fields', () => {
  const sql = readCandidate()
  assert.match(sql, /`notificationCount` INTEGER NOT NULL DEFAULT 0/)
  assert.match(sql, /`baselineImport` BOOLEAN NOT NULL DEFAULT false/)
  for (const column of [
    'lastCheckedAt',
    'lastSuccessfulSyncAt',
    'lastChangedAt',
    'lastExternalId',
    'consecutiveFailures',
    'nextAllowedSyncAt',
    'lastErrorCode',
    'lastErrorAt',
    'baselineCompletedAt',
    'syncRequestedAt',
    'lockToken',
    'lockUntil',
  ]) {
    assert.match(sql, new RegExp('`' + column + '`'))
  }
  assert.match(sql, /UNIQUE INDEX `SocialSyncState_platform_target_key`\s*\(`platform`,\s*`target`\)/)
  assert.match(sql, /INDEX `SocialSyncState_nextAllowedSyncAt_idx`\s*\(`nextAllowedSyncAt`\)/)
  assert.match(sql, /INDEX `SocialSyncState_lastSuccessfulSyncAt_idx`\s*\(`lastSuccessfulSyncAt`\)/)
})

test('production incremental candidate preserves MySQL and User FK compatibility', () => {
  const sql = readCandidate()
  const tableDefinitions = [...sql.matchAll(/CREATE TABLE `[^`]+`[\s\S]*?DEFAULT CHARACTER SET ([^ ]+) COLLATE ([^;]+);/g)]
  assert.equal(tableDefinitions.length, 6)
  for (const definition of tableDefinitions) {
    assert.equal(definition[1], 'utf8mb4')
    assert.equal(definition[2], 'utf8mb4_unicode_ci')
  }
  assert.match(sql, /SocialPostLike[\s\S]*?`userId` VARCHAR\(191\) NOT NULL/)
  assert.match(sql, /SocialPostComment[\s\S]*?`authorId` VARCHAR\(191\) NOT NULL/)
  assert.match(sql, /FOREIGN KEY \(`userId`\) REFERENCES `User`\(`id`\)/)
  assert.match(sql, /FOREIGN KEY \(`authorId`\) REFERENCES `User`\(`id`\)/)
})
