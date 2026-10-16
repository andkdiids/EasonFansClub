import assert from 'node:assert/strict'
import test from 'node:test'
import { canSubmitTopicActivityV2Entry, normalizeTopicActivityV2Progress } from '../components/activities/topic-activity-v2-types'

test('platform status precedence is granted > approved > pending > rejected regardless of submission order', () => {
  for (const statuses of [['REJECTED', 'PENDING', 'APPROVED'], ['APPROVED', 'REJECTED', 'PENDING']]) {
    const rows = normalizeTopicActivityV2Progress({ submissions: statuses.map((status) => ({ id: status, rewardEntryId: 'entry', status, commentId: 'comment-' + status })) })
    assert.equal(rows[0].status, 'APPROVED')
    assert.equal(rows[0].commentId, 'comment-APPROVED')
  }
  assert.equal(normalizeTopicActivityV2Progress({ submissions: [{ rewardEntryId: 'entry', status: 'REJECTED' }, { rewardEntryId: 'entry', status: 'PENDING' }] })[0].status, 'PENDING')
})

test('granted state and displayed amount come only from actual successful grant rows, not configured rewards', () => {
  const [row] = normalizeTopicActivityV2Progress({ submissions: [{ rewardEntryId: 'entry', status: 'REJECTED', commentId: 'comment' }], grants: [
    { rewardEntryId: 'entry', status: 'FAILED', kind: 'POINTS', points: 100 },
    { rewardEntryId: 'entry', status: 'GRANTED', kind: 'POINTS', points: 7 },
    { rewardEntryId: 'entry', status: 'GRANTED', kind: 'BADGE', points: 999 },
  ] })
  assert.equal(row.status, 'GRANTED'); assert.equal(row.grantedPoints, 7)
  assert.equal(row.commentId, 'comment')
  assert.equal(normalizeTopicActivityV2Progress({ grants: [{ rewardEntryId: 'entry', status: 'GRANTED' }] })[0].grantedPoints, null)
})

test('approved, pending and granted can never resubmit, even with allowResubmit enabled', () => {
  for (const status of ['APPROVED', 'PENDING', 'GRANTED', 'UNAVAILABLE'] as const) assert.equal(canSubmitTopicActivityV2Entry(status, true), false)
  assert.equal(canSubmitTopicActivityV2Entry('NOT_STARTED', false), true)
  assert.equal(canSubmitTopicActivityV2Entry('REJECTED', true), true)
  assert.equal(canSubmitTopicActivityV2Entry('REJECTED', false), false)
})

test('unknown server states fail closed and null optional progress is safe', () => {
  assert.deepEqual(normalizeTopicActivityV2Progress(null), [])
  const [row] = normalizeTopicActivityV2Progress({ submissions: [{ rewardEntryId: 'entry', status: 'FUTURE_STATE' }] })
  assert.equal(row.status, 'UNAVAILABLE')
  assert.equal(canSubmitTopicActivityV2Entry(row.status, true), false)
})
