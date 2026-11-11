import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renewInstagramSyncLease, type SyncStateDb } from '../lib/instagram/sync-state'

test('renewal atomically requires the current token and an unexpired lease', async () => {
  const now = new Date('2026-01-01T00:00:00Z')
  let token = 'owner-a'
  let expires = new Date(now.getTime() + 1000)
  const db = { socialSyncState: { updateMany: async ({ where, data }: { where: { lockToken: string; lockUntil: { gt: Date } }; data: { lockUntil: Date } }) => {
    if (where.lockToken !== token || expires <= where.lockUntil.gt) return { count: 0 }
    expires = data.lockUntil
    return { count: 1 }
  } } } as unknown as SyncStateDb
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: 'owner-a', now, leaseMs: 5000, db }), true)
  assert.equal(expires.getTime(), now.getTime() + 5000)
  token = 'owner-b'
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: 'owner-a', now, leaseMs: 5000, db }), false)
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: 'owner-b', now: new Date(now.getTime() + 6000), leaseMs: 5000, db }), false)
  assert.equal(await renewInstagramSyncLease({ target: 'test', token: '', now, leaseMs: 5000, db }), false)
})
