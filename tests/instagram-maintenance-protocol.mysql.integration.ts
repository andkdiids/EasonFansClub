import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { InstagramAdmissionUnavailableError, withInstagramMaintenanceDrain, withInstagramWorkerAdmission } from '../lib/instagram/maintenance-protocol'

async function main() {
  const raw = process.env.RC14_ISOLATED_MYSQL_URL || ''
  const url = new URL(raw)
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/ecfc_rc14_worker_qa') throw new Error('REFUSING_NON_ISOLATED_DATABASE')
  const workerA = new PrismaClient({ datasources: { db: { url: raw } } })
  const workerB = new PrismaClient({ datasources: { db: { url: raw } } })
  const maintenanceDb = new PrismaClient({ datasources: { db: { url: raw } } })
  try {
    const tables = await maintenanceDb.$queryRaw<Array<{ TABLE_NAME: string }>>`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    if (tables.length) throw new Error('REFUSING_NONEMPTY_DATABASE')
    await maintenanceDb.$executeRawUnsafe('CREATE TABLE SocialSyncState (id VARCHAR(191) PRIMARY KEY, platform VARCHAR(32) NOT NULL, target VARCHAR(191) NOT NULL, lockToken VARCHAR(64), lockUntil DATETIME(3), updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY platform_target (platform,target))')
    await maintenanceDb.$executeRawUnsafe('CREATE TABLE SiteSetting (id VARCHAR(191) PRIMARY KEY, `key` VARCHAR(191) NOT NULL UNIQUE, `value` TEXT NOT NULL, valueType VARCHAR(32) NOT NULL DEFAULT \'TEXT\', `group` VARCHAR(191) NOT NULL DEFAULT \'general\', label VARCHAR(191), updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))')
    await maintenanceDb.$executeRawUnsafe("INSERT INTO SocialSyncState (id,platform,target,lockToken,lockUntil) VALUES ('test','INSTAGRAM','test',NULL,NULL)")

    // The first expand deployment must drain while the legacy schema still
    // lacks leaseGeneration, apply the additive DDL under the hold, then
    // fence the expanded row before releasing maintenance.
    await withInstagramMaintenanceDrain(maintenanceDb, 'test', async () => {
      const hold = await maintenanceDb.siteSetting.findUnique({ where: { key: 'instagram_worker_maintenance_hold:test' } })
      assert.equal(hold?.value, 'HELD')
      await maintenanceDb.$executeRawUnsafe('ALTER TABLE SocialSyncState ADD COLUMN leaseGeneration BIGINT NOT NULL DEFAULT 0')
    }, { timeoutMs: 30_000, pollMs: 20, allowLegacyLeaseSchema: true })
    const expandedColumn = await maintenanceDb.$queryRaw<Array<{ COLUMN_NAME: string }>>`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SocialSyncState' AND COLUMN_NAME = 'leaseGeneration'`
    assert.equal(expandedColumn.length, 1, 'legacy-schema maintenance must complete only after the generation column exists')

    let releaseWorker!: () => void
    let enteredWorker!: () => void
    const workerRelease = new Promise<void>((resolve) => { releaseWorker = resolve })
    const workerEntered = new Promise<void>((resolve) => { enteredWorker = resolve })
    const activeWorker = withInstagramWorkerAdmission(workerA, 'test', async () => {
      enteredWorker()
      await workerRelease
      await workerB.$executeRaw`UPDATE SocialSyncState SET lockToken='orphaned', lockUntil=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND), leaseGeneration=5 WHERE id='test'`
    }, { transactionTimeoutMs: 30_000 })
    await workerEntered

    let maintenanceEntered = false
    let releaseMaintenance!: () => void
    const maintenanceRelease = new Promise<void>((resolve) => { releaseMaintenance = resolve })
    const maintenance = withInstagramMaintenanceDrain(maintenanceDb, 'test', async () => {
      maintenanceEntered = true
      const hold = await maintenanceDb.siteSetting.findUnique({ where: { key: 'instagram_worker_maintenance_hold:test' } })
      assert.equal(hold?.value, 'HELD', 'maintenance hold must be persisted before drain completes')
      await maintenanceDb.$executeRawUnsafe('ALTER TABLE SocialSyncState ADD COLUMN migrationProbe INT NOT NULL DEFAULT 0')
      const rows = await maintenanceDb.$queryRaw<Array<{ lockToken: string | null; generation: bigint }>>`SELECT lockToken, leaseGeneration AS generation FROM SocialSyncState WHERE id='test'`
      assert.equal(rows[0]?.lockToken, null)
      assert.equal(BigInt(rows[0]?.generation), BigInt(6), 'orphan recovery must advance the fencing generation')
      await maintenanceRelease
    }, { timeoutMs: 30_000, pollMs: 20 })

    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(maintenanceEntered, false, 'maintenance must wait for the live worker session to drain')
    await assert.rejects(
      withInstagramWorkerAdmission(workerB, 'test', async () => undefined, { transactionTimeoutMs: 5_000 }),
      (error: unknown) => error instanceof InstagramAdmissionUnavailableError,
      'a second worker must not enter while the first has the active-task lock',
    )
    releaseWorker()
    await activeWorker
    while (!maintenanceEntered) await new Promise((resolve) => setTimeout(resolve, 10))
    await assert.rejects(
      withInstagramWorkerAdmission(workerB, 'test', async () => undefined, { transactionTimeoutMs: 5_000 }),
      (error: unknown) => error instanceof InstagramAdmissionUnavailableError,
      'maintenance admission lock must reject new workers while drain callback runs',
    )
    releaseMaintenance()
    await maintenance

    const after = await maintenanceDb.$queryRaw<Array<{ lockToken: string | null; generation: bigint }>>`SELECT lockToken, leaseGeneration AS generation FROM SocialSyncState WHERE id='test'`
    assert.equal(after[0]?.lockToken, null)
    assert.equal(BigInt(after[0]?.generation), BigInt(6))

    await assert.rejects(withInstagramMaintenanceDrain(maintenanceDb, 'test', async () => { throw new Error('SIMULATED_MAINTENANCE_CRASH') }, { timeoutMs: 5_000, pollMs: 20 }), /SIMULATED_MAINTENANCE_CRASH/)
    await assert.rejects(
      withInstagramWorkerAdmission(workerB, 'test', async () => undefined, { transactionTimeoutMs: 5_000 }),
      (error: unknown) => error instanceof InstagramAdmissionUnavailableError,
      'a committed maintenance hold must survive loss of the maintenance session',
    )
    await withInstagramMaintenanceDrain(maintenanceDb, 'test', async () => undefined, { timeoutMs: 5_000, pollMs: 20 })
    const holdAfterRecovery = await maintenanceDb.siteSetting.findUnique({ where: { key: 'instagram_worker_maintenance_hold:test' } })
    assert.equal(holdAfterRecovery?.value, 'RELEASED', 'a successful recovery run clears the persistent hold')
    console.log('REAL_MYSQL_ADMISSION_DRAIN_CRASH_FENCE=PASS')
  } finally {
    await Promise.allSettled([workerA.$disconnect(), workerB.$disconnect(), maintenanceDb.$executeRawUnsafe('DROP TABLE IF EXISTS SiteSetting'), maintenanceDb.$executeRawUnsafe('DROP TABLE IF EXISTS SocialSyncState')])
    await maintenanceDb.$disconnect()
  }
}

main().catch((error: Error) => { console.error(error); process.exitCode = 1 })
