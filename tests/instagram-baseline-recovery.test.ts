import assert from 'node:assert/strict'
import test from 'node:test'
import type { SyncStateDb } from '@/lib/instagram/sync-state'
import { runInstagramSyncWorkerOnce } from '@/lib/instagram/worker'
import type { SyncInstagramPostsResult } from '@/lib/instagram/sync-service'

type FakeState = {
  id: string
  platform: 'INSTAGRAM'
  target: string
  leaseGeneration: bigint
  lockToken: string | null
  lockUntil: Date | null
  lastCheckedAt: Date | null
  lastSuccessfulSyncAt: Date | null
  lastChangedAt: Date | null
  lastExternalId: string | null
  consecutiveFailures: number
  nextAllowedSyncAt: Date | null
  lastErrorCode: string | null
  lastErrorAt: Date | null
  baselineCompletedAt: Date | null
  syncRequestedAt: Date | null
}

function createFakeDb(initial: Partial<FakeState> = {}, failLatestStateRead = false, renewalSucceeded = true) {
  const state: FakeState = {
    id: 'sync-state-test', platform: 'INSTAGRAM', target: 'mreasonchan', leaseGeneration: BigInt(0),
    lockToken: null, lockUntil: null, lastCheckedAt: null, lastSuccessfulSyncAt: null,
    lastChangedAt: null, lastExternalId: null, consecutiveFailures: 0,
    nextAllowedSyncAt: null, lastErrorCode: null, lastErrorAt: null,
    baselineCompletedAt: null, syncRequestedAt: null,
    ...initial,
  }
  let stateReads = 0
  const tx = {
    $executeRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join('')
      if (sql.includes('SET lockUntil = TIMESTAMPADD')) {
        return renewalSucceeded && state.lockToken === values[1] && state.leaseGeneration === values[2] && state.lockUntil && state.lockUntil.getTime() > Date.now() ? 1 : 0
      }
      if (sql.includes('SET lockToken = NULL, lockUntil = NULL')) {
        const ownsLiveLease = state.target === values[0] && state.lockToken === values[1]
          && state.leaseGeneration === values[2] && state.lockUntil && state.lockUntil.getTime() > Date.now()
        if (!ownsLiveLease) return 0
        state.lockToken = null
        state.lockUntil = null
        return 1
      }
      if (!sql.includes('leaseGeneration = leaseGeneration + 1')) return 1
      if (state.lockUntil && state.lockUntil.getTime() > Date.now()) return 0
      state.lockToken = String(values[0])
      state.lockUntil = new Date(Date.now() + Number(values[1]) / 1000)
      state.leaseGeneration += BigInt(1)
      return 1
    },
    $queryRaw: async (parts: TemplateStringsArray) => {
      if (parts.join('').includes('SELECT leaseGeneration, lockUntil')) {
        return state.lockToken && state.lockUntil ? [{ leaseGeneration: state.leaseGeneration, lockUntil: state.lockUntil }] : []
      }
      return state.lockToken && state.lockUntil && state.lockUntil.getTime() > Date.now() ? [{ id: state.id }] : []
    },
    socialSyncState: {
      update: async ({ data }: { data: Partial<FakeState> }) => Object.assign(state, data),
    },
  }
  const db = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    socialSyncState: {
      findUnique: async () => {
        stateReads += 1
        if (failLatestStateRead && stateReads === 3) throw new Error('simulated state read failure after lease acquisition')
        return state
      },
      create: async () => state,
      findUniqueOrThrow: async () => state,
      updateMany: async ({ where, data }: {
        where: { lockToken?: string; leaseGeneration?: bigint; OR?: Array<{ lockUntil: null } | { lockUntil: { lt: Date } }> }
        data: Partial<FakeState>
      }) => {
        if (where.OR) {
          const expiry = where.OR.find((condition) => condition.lockUntil !== null && typeof condition.lockUntil === 'object')
          const due = expiry && typeof expiry.lockUntil === 'object' ? expiry.lockUntil.lt : null
          if (state.lockUntil && due && state.lockUntil >= due) return { count: 0 }
        } else if (where.lockToken && (state.lockToken !== where.lockToken || (where.leaseGeneration !== undefined && state.leaseGeneration !== where.leaseGeneration))) {
          return { count: 0 }
        }
        Object.assign(state, data)
        return { count: 1 }
      },
    },
    socialSyncLog: {
      count: async () => 0,
      findFirst: async () => null,
    },
  }
  return { db: db as unknown as SyncStateDb, state }
}

function syncResult(status: SyncInstagramPostsResult['status'], errorCode: string | null = null): SyncInstagramPostsResult {
  return {
    syncLogId: 'sync-log-test', provider: 'apify', target: 'mreasonchan', status,
    foundCount: 0, createdCount: 0, updatedCount: 0, mediaCount: 0, notifiedCount: 0,
    errorCode, newExternalIds: [], latestExternalId: null, retryAfterSeconds: null,
  }
}

function withSyncEnabled<T>(run: () => Promise<T>) {
  const environment = process.env as Record<string, string | undefined>
  const previousSyncEnabled = environment.ANYWHERE_DOOR_SYNC_ENABLED
  const previousNodeEnv = environment.NODE_ENV
  environment.ANYWHERE_DOOR_SYNC_ENABLED = 'true'
  environment.NODE_ENV = 'test'
  return run().finally(() => {
    if (previousSyncEnabled === undefined) delete environment.ANYWHERE_DOOR_SYNC_ENABLED
    else environment.ANYWHERE_DOOR_SYNC_ENABLED = previousSyncEnabled
    if (previousNodeEnv === undefined) delete environment.NODE_ENV
    else environment.NODE_ENV = previousNodeEnv
  })
}

test('an exhausted initial baseline becomes automatically retryable after backoff and releases its lease', async () => {
  await withSyncEnabled(async () => {
    const firstAt = new Date('2026-10-17T19:00:00.000Z')
    const { db, state } = createFakeDb({ syncRequestedAt: firstAt })
    const calls: Array<{ baseline: boolean; limit: number }> = []
    const failed = await runInstagramSyncWorkerOnce({
      db, now: firstAt,
      runSync: async (options) => {
        calls.push({ baseline: options.baseline, limit: options.limit })
        return syncResult('FAILED', 'MEDIA_REQUEST_FAILED')
      },
    })
    assert.equal(failed.status, 'FAILED')
    assert.equal(state.baselineCompletedAt, null)
    assert.equal(state.syncRequestedAt, null)
    assert.equal(state.lastErrorCode, 'MEDIA_REQUEST_FAILED')
    assert.equal(state.lockToken, null)
    assert.deepEqual(calls, [{ baseline: true, limit: 20 }])

    const retryAt = new Date(firstAt.getTime() + 31 * 60 * 1000)
    const recovered = await runInstagramSyncWorkerOnce({
      db, now: retryAt,
      runSync: async (options) => {
        calls.push({ baseline: options.baseline, limit: options.limit })
        return syncResult('SUCCEEDED')
      },
    })
    assert.equal(recovered.status, 'SUCCEEDED')
    assert.deepEqual(calls, [{ baseline: true, limit: 20 }, { baseline: true, limit: 20 }])
    assert.equal((state.baselineCompletedAt as Date | null)?.toISOString(), retryAt.toISOString())
    assert.equal((state.lastSuccessfulSyncAt as Date | null)?.toISOString(), retryAt.toISOString())
    assert.equal(state.lastErrorAt, null)
    assert.equal(state.lockToken, null)
  })
})

test('an untouched installation still requires explicit baseline initialization', async () => {
  await withSyncEnabled(async () => {
    const now = new Date('2026-10-17T19:00:00.000Z')
    const { db, state } = createFakeDb()
    let providerCalled = false
    const result = await runInstagramSyncWorkerOnce({
      db, now,
      runSync: async () => { providerCalled = true; return syncResult('SUCCEEDED') },
    })
    assert.equal(result.status, 'BASELINE_REQUIRED')
    assert.equal(providerCalled, false)
    assert.equal(state.lockToken, null)
  })
})

test('a database read failure after lease acquisition is recorded and still releases the lease', async () => {
  await withSyncEnabled(async () => {
    const now = new Date('2026-10-17T19:00:00.000Z')
    const { db, state } = createFakeDb({ syncRequestedAt: now }, true)
    let syncCalled = false
    const result = await runInstagramSyncWorkerOnce({
      db,
      now,
      runSync: async () => { syncCalled = true; return syncResult('SUCCEEDED') },
    })

    assert.equal(result.status, 'FAILED')
    assert.equal(result.errorCode, 'SYNC_FAILED')
    assert.equal(syncCalled, false)
    assert.equal(state.lastErrorCode, 'SYNC_FAILED')
    assert.equal(state.lockToken, null)
    assert.equal(state.lockUntil, null)
  })
})

test('heartbeat loss aborts the task, reports LOST_LEASE, and prevents success or failure writes', async () => {
  await withSyncEnabled(async () => {
    const now = new Date('2026-10-17T19:00:00.000Z')
    const { db, state } = createFakeDb({ syncRequestedAt: now }, false, false)
    let taskAborted = false
    const result = await runInstagramSyncWorkerOnce({
      db,
      now,
      heartbeatIntervalMs: 10,
      runSync: ({ lease }) => new Promise((resolve) => {
        lease.signal?.addEventListener('abort', () => {
          taskAborted = true
          resolve(syncResult('FAILED', 'ABORTED'))
        }, { once: true })
      }),
    })

    assert.equal(taskAborted, true)
    assert.equal(result.status, 'LOST_LEASE')
    assert.equal(state.lastErrorCode, null)
    assert.equal(state.lastSuccessfulSyncAt, null)
    assert.equal(state.lockToken, null)
  })
})
