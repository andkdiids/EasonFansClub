import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { withInstagramLeaseTransaction } from '../lib/instagram/sync-state'

async function main() {
  const raw = process.env.RC14_ISOLATED_MYSQL_URL || ''
  const url = new URL(raw)
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/ecfc_rc14_worker_qa') throw new Error('REFUSING_NON_ISOLATED_DATABASE')
  const db = new PrismaClient({ datasources: { db: { url: raw } } })
  const rival = new PrismaClient({ datasources: { db: { url: raw } } })
  try {
    const tables = await db.$queryRaw<Array<{ TABLE_NAME: string }>>`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    if (tables.length) throw new Error('REFUSING_NONEMPTY_DATABASE')
    await db.$executeRawUnsafe('CREATE TABLE SocialSyncState (id VARCHAR(191) PRIMARY KEY, platform VARCHAR(32) NOT NULL, target VARCHAR(191) NOT NULL, lockToken VARCHAR(64), lockUntil DATETIME(3), leaseGeneration BIGINT NOT NULL DEFAULT 0, updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY platform_target (platform,target))')
    await db.$executeRawUnsafe("INSERT INTO SocialSyncState (id,platform,target,lockToken,lockUntil,leaseGeneration) VALUES ('test','INSTAGRAM','test','owner-a',UTC_TIMESTAMP(3) + INTERVAL 2 MINUTE,1)")
    let release!: () => void
    let entered!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
    const guarded = withInstagramLeaseTransaction({ target: 'test', token: 'owner-a', generation: BigInt(1), db }, async (tx) => {
      entered()
      await wait
      await tx.$executeRawUnsafe("UPDATE SocialSyncState SET updatedAt=UTC_TIMESTAMP(3) WHERE id='test'")
    })
    await enteredPromise
    let replaced = false
    const replacement = rival.$executeRawUnsafe("UPDATE SocialSyncState SET leaseGeneration=leaseGeneration+1 WHERE id='test'").then(() => { replaced = true })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(replaced, false, 'competing ownership update must wait for the guarded transaction')
    release()
    await guarded
    await replacement
    let staleWrite = false
    await assert.rejects(withInstagramLeaseTransaction({ target: 'test', token: 'owner-a', generation: BigInt(1), db }, async () => { staleWrite = true }), /INSTAGRAM_LEASE_LOST/)
    assert.equal(staleWrite, false)
    await withInstagramLeaseTransaction({ target: 'test', token: 'owner-a', generation: BigInt(2), db }, async (tx) => {
      await tx.$executeRawUnsafe("UPDATE SocialSyncState SET updatedAt=UTC_TIMESTAMP(3) WHERE id='test'")
    })
    await rival.$executeRawUnsafe("UPDATE SocialSyncState SET lockToken='owner-b' WHERE id='test'")
    await assert.rejects(withInstagramLeaseTransaction({ target: 'test', token: 'owner-a', generation: BigInt(2), db }, async () => { staleWrite = true }), /INSTAGRAM_LEASE_LOST/)
    assert.equal(staleWrite, false)
    console.log('REAL_MYSQL_ROW_LOCK_AND_STALE_OWNER=PASS')
  } finally {
    await db.$executeRawUnsafe('DROP TABLE IF EXISTS SocialSyncState').catch(() => undefined)
    await rival.$disconnect()
    await db.$disconnect()
  }
}
main().catch((error: Error) => { console.error(error.message); process.exitCode = 1 })
