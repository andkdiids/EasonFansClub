import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prisma, PrismaClient } from '@prisma/client'
import { acquireInstagramSyncLease, getInstagramSyncState, requestInstagramSync, withInstagramLeaseTransaction } from '../lib/instagram/sync-state'

test('a missing sync state stays read-only until the lease bootstrap transaction', async () => {
  let creates = 0
  const db = {
    socialSyncState: {
      findUnique: async () => null,
      create: async () => { creates += 1 },
    },
  } as never
  await assert.rejects(getInstagramSyncState('target', db), /INSTAGRAM_SYNC_STATE_MISSING/)
  assert.equal(creates, 0)
})

test('lease acquisition bootstraps a missing state row and atomically assigns generation one', async () => {
  let exists = false
  let generation = BigInt(0)
  let token: string | null = null
  let lockUntil: Date | null = null
  let insertedInsideTransaction = false
  const tx = {
    socialSyncState: {
      createMany: async () => {
        assert.equal(exists, false)
        insertedInsideTransaction = true
        exists = true
        return { count: 1 }
      },
      findUnique: async () => exists ? { id: 'lease-state' } : null,
    },
    $executeRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join('')
      if (!sql.includes('leaseGeneration = leaseGeneration + 1')) return 1
      if (token && lockUntil && lockUntil.getTime() > Date.now()) return 0
      token = String(values[0])
      lockUntil = new Date(Date.now() + Number(values[1]) / 1000)
      generation += BigInt(1)
      return 1
    },
    $queryRaw: async (parts: TemplateStringsArray) => parts.join('').includes('SELECT leaseGeneration, lockUntil')
      ? token && lockUntil ? [{ leaseGeneration: generation, lockUntil }] : []
      : [],
  }
  const db = {
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
  } as never

  const lease = await acquireInstagramSyncLease({ target: 'target', token: 'bootstrap-owner', db })
  assert.equal(insertedInsideTransaction, true)
  assert.equal(lease.acquired, true)
  assert.equal(lease.generation, BigInt(1))
  assert.equal(token, 'bootstrap-owner')
})

test('lease-guarded write runs only inside the transaction after row check', async () => {
  let exists = false
  let writes = 0
  const tx = { $queryRaw: async () => exists ? [{ id: 'lease' }] : [] } as unknown as Prisma.TransactionClient
  const db = { $transaction: async <T>(callback: (client: Prisma.TransactionClient) => Promise<T>) => callback(tx) } as Pick<PrismaClient, '$transaction'>
  const write = async () => { writes++; return 'done' }
  await assert.rejects(withInstagramLeaseTransaction({ target: 'target', token: 'old', generation: BigInt(1), db }, write), /INSTAGRAM_LEASE_LOST/)
  assert.equal(writes, 0)
  exists = true
  assert.equal(await withInstagramLeaseTransaction({ target: 'target', token: 'owner', generation: BigInt(1), db }, write), 'done')
  assert.equal(writes, 1)
  await assert.rejects(withInstagramLeaseTransaction({ target: 'target', token: '', generation: BigInt(1), db }, write), /INSTAGRAM_LEASE_INVALID/)
  await assert.rejects(withInstagramLeaseTransaction({ target: 'target', token: 'owner', generation: BigInt(0), db }, write), /INSTAGRAM_LEASE_INVALID/)
})

test('manual sync request is a generation-fenced SocialSyncState write', async () => {
  let ownsLease = false
  let writes = 0
  const tx = {
    $queryRaw: async () => ownsLease ? [{ id: 'lease' }] : [],
    socialSyncState: {
      update: async (input: { data: { syncRequestedAt: Date } }) => {
        writes += 1
        return input.data
      },
    },
  } as unknown as Prisma.TransactionClient
  const db = { $transaction: async <T>(callback: (client: Prisma.TransactionClient) => Promise<T>) => callback(tx) } as Pick<PrismaClient, '$transaction'>
  const requestedAt = new Date()
  const lease = { target: 'target', token: 'owner', generation: BigInt(2), assertActive: () => undefined }

  await assert.rejects(requestInstagramSync({ target: 'target', requestedAt, lease, db }), /INSTAGRAM_LEASE_LOST/)
  assert.equal(writes, 0)
  ownsLease = true
  assert.deepEqual(await requestInstagramSync({ target: 'target', requestedAt, lease, db }), { syncRequestedAt: requestedAt })
  assert.equal(writes, 1)
})
