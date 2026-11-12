import 'dotenv/config'
import { createInterface } from 'node:readline'
import { PrismaClient } from '@prisma/client'
import {
  acquireInstagramSyncLease,
  releaseInstagramSyncLease,
  renewInstagramSyncLease,
  withInstagramLeaseTransaction,
} from '../../lib/instagram/sync-state'
import {
  withInstagramMaintenanceDrain,
  withInstagramWorkerAdmission,
} from '../../lib/instagram/maintenance-protocol'

const databaseUrl = process.env.RC14_ISOLATED_MYSQL_URL || ''
const target = process.env.RC14_TEST_TARGET || 'rc14-worker-process-test'
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

function emit(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)}\n`)
}

function inputLines() {
  return createInterface({ input: process.stdin, crlfDelay: Infinity })
}

async function waitForInput(command: (line: string) => Promise<boolean>) {
  const lines = inputLines()
  for await (const line of lines) {
    if (await command(line)) {
      lines.close()
      return
    }
  }
}

async function main() {
  const operation = process.argv[2]
  if (operation === 'acquire') {
    const lease = await acquireInstagramSyncLease({
      target,
      token: process.env.RC14_TEST_TOKEN,
      leaseMs: Number(process.env.RC14_TEST_LEASE_MS || 30_000),
      db,
    })
    emit({ event: 'acquired', acquired: lease.acquired, token: lease.token, generation: lease.generation, lockUntil: lease.lockUntil })
    await db.$disconnect()
    return
  }

  if (operation === 'hold-lease') {
    const lease = await acquireInstagramSyncLease({
      target,
      token: process.env.RC14_TEST_TOKEN,
      leaseMs: Number(process.env.RC14_TEST_LEASE_MS || 30_000),
      db,
    })
    if (!lease.acquired || lease.generation === null) {
      emit({ event: 'acquired', acquired: false })
      await db.$disconnect()
      return
    }
    emit({ event: 'acquired', acquired: true, token: lease.token, generation: lease.generation, lockUntil: lease.lockUntil })
    await waitForInput(async (line) => {
      if (line === 'RENEW') {
        const renewed = await renewInstagramSyncLease({ target, token: lease.token, generation: lease.generation!, now: new Date(), leaseMs: Number(process.env.RC14_TEST_LEASE_MS || 30_000), db })
        emit({ event: 'renewed', renewed })
        return false
      }
      if (line === 'WRITE') {
        try {
          await withInstagramLeaseTransaction({ target, token: lease.token, generation: lease.generation!, db }, async (tx) => {
            await tx.socialSyncState.update({ where: { platform_target: { platform: 'INSTAGRAM', target } }, data: { lastErrorCode: 'child-write' } })
          })
          emit({ event: 'write', accepted: true })
        } catch (error) {
          emit({ event: 'write', accepted: false, error: error instanceof Error ? error.message : String(error) })
        }
        return false
      }
      if (line === 'RELEASE') {
        const released = await releaseInstagramSyncLease(target, lease.token, lease.generation!, db)
        emit({ event: 'released', released })
        return true
      }
      if (line === 'EXIT') return true
      return false
    })
    await db.$disconnect()
    return
  }

  if (operation === 'stale-write') {
    try {
      await withInstagramLeaseTransaction({
        target,
        token: process.env.RC14_TEST_TOKEN || '',
        generation: BigInt(process.env.RC14_TEST_GENERATION || '0'),
        db,
      }, async (tx) => {
        await tx.socialSyncState.update({ where: { platform_target: { platform: 'INSTAGRAM', target } }, data: { lastErrorCode: 'stale-child-write' } })
      })
      emit({ event: 'stale-write', accepted: true })
    } catch (error) {
      emit({ event: 'stale-write', accepted: false, error: error instanceof Error ? error.message : String(error) })
    }
    await db.$disconnect()
    return
  }

  if (operation === 'hold-worker') {
    await withInstagramWorkerAdmission(db, target, async () => {
      const lease = await acquireInstagramSyncLease({
        target,
        token: process.env.RC14_TEST_TOKEN,
        leaseMs: Number(process.env.RC14_TEST_LEASE_MS || 30_000),
        db,
      })
      emit({ event: 'worker-active', acquired: lease.acquired, token: lease.token, generation: lease.generation, lockUntil: lease.lockUntil })
      if (lease.acquired && lease.generation !== null) {
        await waitForInput(async (line) => {
          if (line === 'WRITE') {
            try {
              await withInstagramLeaseTransaction({ target, token: lease.token, generation: lease.generation!, db }, async (tx) => {
                await tx.socialSyncState.update({ where: { platform_target: { platform: 'INSTAGRAM', target } }, data: { lastErrorCode: 'active-child-write' } })
              })
              emit({ event: 'worker-write', accepted: true })
            } catch (error) {
              emit({ event: 'worker-write', accepted: false, error: error instanceof Error ? error.message : String(error) })
            }
            return false
          }
          if (line === 'RELEASE') {
            const released = await releaseInstagramSyncLease(target, lease.token, lease.generation!, db)
            emit({ event: 'worker-lease-released', released })
            return true
          }
          if (line === 'EXIT') return true
          return false
        })
      }
    })
    emit({ event: 'worker-drained' })
    await db.$disconnect()
    return
  }

  if (operation === 'hold-admission') {
    await withInstagramWorkerAdmission(db, target, async () => {
      emit({ event: 'admitted' })
      await waitForInput(async (line) => line === 'RELEASE')
    })
    emit({ event: 'admission-released' })
    await db.$disconnect()
    return
  }

  if (operation === 'hold-maintenance') {
    await withInstagramMaintenanceDrain(db, target, async () => {
      emit({ event: 'maintenance-acquired' })
      await waitForInput(async (line) => line === 'RELEASE')
    }, { timeoutMs: Number(process.env.RC14_TEST_TIMEOUT_MS || 10_000), pollMs: 25 })
    emit({ event: 'maintenance-released' })
    await db.$disconnect()
    return
  }

  throw new Error(`UNKNOWN_OPERATION:${operation}`)
}

void main().catch(async (error) => {
  emit({ event: 'error', message: error instanceof Error ? error.message : String(error) })
  await db.$disconnect().catch(() => undefined)
  process.exitCode = 1
})
