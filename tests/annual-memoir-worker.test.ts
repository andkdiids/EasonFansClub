import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const worker = readFileSync('lib/annual-memoir-worker.ts', 'utf8')

test('opening notification uses a locked reservation and stable recipient key', () => {
  assert.match(worker, /FROM AnnualMemoirReservation WHERE id = .* FOR UPDATE/)
  assert.match(worker, /\.canNotify\) return/)
  assert.match(worker, /recipientId_key: \{ recipientId: row.userId, key \}/)
  assert.ok(worker.indexOf('await upsertNotificationWithDb(tx') < worker.indexOf('data: { notifiedAt: now }'))
})

test('maintenance resumes pending rewards and separates annual settlement', () => {
  assert.match(worker, /pointsGrantedAt: null.*badgeGrantedAt: null/)
  assert.match(worker, /await fulfillMemoirReservation\(row.id\)/)
  assert.match(worker, /now < config.settlementAt/)
  assert.match(worker, /annual-memoir-completion:/)
  assert.match(worker, /row.settledAt/)
  assert.match(readFileSync('server.ts', 'utf8'), /runAnnualMemoirMaintenance\(\)/)
})
