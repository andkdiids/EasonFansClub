import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { acquireInstagramSyncLease, releaseInstagramSyncLease } from '../lib/instagram/sync-state'

async function main() {
  const raw = process.env.RC14_ISOLATED_MYSQL_URL || ''
  const url = new URL(raw)
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/ecfc_rc14_worker_qa') {
    throw new Error('REFUSING_NON_ISOLATED_DATABASE')
  }
  const db = new PrismaClient({ datasources: { db: { url: raw } } })
  let created = false
  let createdLedger = false
  try {
    const tables = await db.$queryRaw<Array<{ TABLE_NAME: string }>>`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    if (tables.length) throw new Error('REFUSING_NONEMPTY_DATABASE')

    // Reproduce the production schema immediately before the new migration.
    await db.$executeRawUnsafe(`CREATE TABLE SocialSyncState (
      id VARCHAR(191) NOT NULL,
      platform ENUM('INSTAGRAM') NOT NULL DEFAULT 'INSTAGRAM',
      target VARCHAR(191) NOT NULL,
      lastCheckedAt DATETIME(3) NULL,
      lastSuccessfulSyncAt DATETIME(3) NULL,
      lastChangedAt DATETIME(3) NULL,
      lastExternalId VARCHAR(191) NULL,
      consecutiveFailures INT NOT NULL DEFAULT 0,
      nextAllowedSyncAt DATETIME(3) NULL,
      lastErrorCode VARCHAR(64) NULL,
      lastErrorAt DATETIME(3) NULL,
      baselineCompletedAt DATETIME(3) NULL,
      syncRequestedAt DATETIME(3) NULL,
      lockToken VARCHAR(64) NULL,
      lockUntil DATETIME(3) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY SocialSyncState_platform_target_key (platform, target)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    created = true
    await db.$executeRawUnsafe(`CREATE TABLE _prisma_migrations (
      id VARCHAR(36) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      finished_at DATETIME(3) NULL,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT NULL,
      rolled_back_at DATETIME(3) NULL,
      applied_steps_count INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      INDEX _prisma_migrations_migration_name_idx (migration_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    createdLedger = true
    await db.$executeRawUnsafe(`INSERT INTO SocialSyncState
      (id, platform, target, lastExternalId, consecutiveFailures, createdAt, updatedAt)
      VALUES ('legacy-state', 'INSTAGRAM', 'rc14-legacy-client-test', 'existing-post', 2, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`)

    const migrationPath = resolve('prisma/migrations/20261111120000_add_instagram_lease_generation/migration.sql')
    const migration = await readFile(migrationPath, 'utf8')
    assert.match(migration, /ALTER TABLE `SocialSyncState` ADD COLUMN `leaseGeneration` BIGINT NOT NULL DEFAULT 0;/)
    const runGuard = (phase: 'before' | 'after') => execFileSync(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/check-instagram-lease-generation-migration.ts'), phase],
      { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: raw }, encoding: 'utf8', timeout: 20_000 },
    )
    assert.match(runGuard('before'), /LEASE_GENERATION_MIGRATION_BEFORE=PENDING/)
    await db.$executeRawUnsafe(migration)
    const checksum = createHash('sha256').update(migration).digest('hex')
    await db.$executeRaw`INSERT INTO _prisma_migrations
      (id, checksum, started_at, finished_at, migration_name, applied_steps_count)
      VALUES (${randomUUID()}, ${checksum}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), '20261111120000_add_instagram_lease_generation', 1)`
    const afterGuard = runGuard('after')
    assert.match(afterGuard, /LEASE_GENERATION_MIGRATION_AFTER=APPLIED/)
    assert.match(afterGuard, /LEASE_GENERATION_MIGRATION_LEDGER=VERIFIED/)

    const field = await db.$queryRaw<Array<{ COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null }>>`
      SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SocialSyncState' AND COLUMN_NAME = 'leaseGeneration'
    `
    assert.deepEqual(field, [{ COLUMN_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_DEFAULT: '0' }])

    // Old generated clients never select the new field; representative reads
    // and updates continue to work while the additive migration is present.
    const legacyRead = await db.$queryRaw<Array<{ id: string; target: string; lastExternalId: string | null; lockToken: string | null }>>`
      SELECT id, target, lastExternalId, lockToken FROM SocialSyncState WHERE id = 'legacy-state'
    `
    assert.deepEqual(legacyRead, [{ id: 'legacy-state', target: 'rc14-legacy-client-test', lastExternalId: 'existing-post', lockToken: null }])
    await db.$executeRaw`UPDATE SocialSyncState SET syncRequestedAt = UTC_TIMESTAMP(3) WHERE id = 'legacy-state'`

    // The new generated Prisma client can read the expanded model and acquire
    // its first generation without affecting the existing row contents.
    const expanded = await db.socialSyncState.findUniqueOrThrow({
      where: { platform_target: { platform: 'INSTAGRAM', target: 'rc14-legacy-client-test' } },
    })
    assert.equal(expanded.leaseGeneration, BigInt(0))
    assert.equal(expanded.lastExternalId, 'existing-post')
    const lease = await acquireInstagramSyncLease({ target: expanded.target, token: 'migration-compatibility-test', db })
    assert.equal(lease.acquired, true)
    assert.equal(lease.generation, BigInt(1))
    assert.equal(await releaseInstagramSyncLease(expanded.target, lease.token, lease.generation!, db), true)
    const released = await db.socialSyncState.findUniqueOrThrow({ where: { id: expanded.id } })
    assert.equal(released.leaseGeneration, BigInt(1), 'release never resets generation')
    assert.equal(released.lastExternalId, 'existing-post')

    console.log('ADDITIVE_LEASE_GENERATION_MIGRATION=PASS')
    console.log('LEGACY_SCHEMA_READ_WRITE_COMPATIBILITY=PASS')
    console.log('NEW_CLIENT_GENERATION_ACQUISITION=PASS')
  } finally {
    if (created) await db.$executeRawUnsafe('DROP TABLE IF EXISTS SocialSyncState')
    if (createdLedger) await db.$executeRawUnsafe('DROP TABLE IF EXISTS _prisma_migrations')
    await db.$disconnect()
  }
}

main().catch((error: Error) => { console.error(error.message); process.exitCode = 1 })
