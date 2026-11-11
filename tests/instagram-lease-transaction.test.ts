import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prisma, PrismaClient } from '@prisma/client'
import { withInstagramLeaseTransaction } from '../lib/instagram/sync-state'

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
