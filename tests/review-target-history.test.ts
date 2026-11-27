import assert from 'node:assert/strict'
import test from 'node:test'
import { withReviewTargetHistory } from '../lib/review-target-history'

const post = { sourceType: 'POST', sourceId: 'post-1', title: '测试' }

test('only an authorized target receives projected history', async () => {
  const row = { id: 'event', actorName: '审核员', actorUid: 42, titleSnapshot: '旧标题',
    createdAt: new Date('2026-11-28T00:00:00Z'), action: 'REJECT_POST', rejectionReason: '原因' }
  const response = await withReviewTargetHistory(post, async ids => {
    assert.deepEqual(ids, [post.sourceId])
    return new Map([[post.sourceId, [row]], ['other', [row]]])
  })
  assert.deepEqual(response, { ...post, history: [{
    id: 'event', actorName: '审核员', createdAt: '2026-11-28T00:00:00.000Z', action: 'REJECT_POST', rejectionReason: '原因',
  }] })
  assert.deepEqual(post, { sourceType: 'POST', sourceId: 'post-1', title: '测试' })
})

test('missing target never loads history and query failure retains the target', async () => {
  assert.equal(await withReviewTargetHistory(null, async () => assert.fail('unexpected query')), null)
  assert.deepEqual(await withReviewTargetHistory(post, async () => { throw new Error('database details') }), { ...post, history: [] })
})
