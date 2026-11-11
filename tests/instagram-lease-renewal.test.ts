import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renewInstagramSyncLease, type SyncStateDb } from '../lib/instagram/sync-state'

test('renewal atomically requires the current token, generation, and database-live lease', async () => {
  const now = new Date()
  let token = 'owner-a'
  let generation = BigInt(1)
  let expires = new Date(now.getTime() + 1000)
  const execute = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join(' ')
    assert.match(sql, /lockUntil > UTC_TIMESTAMP\(3\)/)
    const [duration, target, ownerToken, ownerGeneration] = values
    if (target !== 'test' || ownerToken !== token || ownerGeneration !== generation || expires <= new Date()) return 0
    expires = new Date(Date.now() + Number(duration) / 1000)
    return 1
  }
  const db = { $transaction: async (callback: (tx: unknown) => Promise<number>) => callback({ $executeRaw: execute }) } as unknown as SyncStateDb

  assert.equal(await renewInstagramSyncLease({ target: 'test', token: 'owner-a', generation, now, leaseMs: 5000, db }), true)
  assert.ok(expires.getTime() - Date.now() > 4_900 && expires.getTime() - Date.now() <= 5_000)
  token = 'owner-b'
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: 'owner-a', generation, now, leaseMs: 5000, db }), false)
  expires = new Date(Date.now() - 1000)
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: 'owner-b', generation, now, leaseMs: 5000, db }), false)
  expires = new Date(Date.now() + 10_000)
  generation += BigInt(1)
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: 'owner-b', generation: generation - BigInt(1), now, leaseMs: 5000, db }), false)
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: 'owner-b', generation, now, leaseMs: 5000, db }), true)
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: '', generation, now, leaseMs: 5000, db }), false)
})
