import assert from 'node:assert/strict'
import test from 'node:test'
import { getReplyLengthMetrics, replyTooLongPayload, REPLY_MAX_LENGTH } from '../lib/reply-length'

test('reply length accepts 299, 300 and reports exact overflow at 301/350', () => {
  assert.equal(REPLY_MAX_LENGTH, 300)
  assert.equal(getReplyLengthMetrics('a'.repeat(299)).exceededBy, 0)
  assert.equal(getReplyLengthMetrics('a'.repeat(300)).exceededBy, 0)
  assert.equal(getReplyLengthMetrics('a'.repeat(301)).exceededBy, 1)
  assert.equal(getReplyLengthMetrics('a'.repeat(350)).exceededBy, 50)
  assert.deepEqual(replyTooLongPayload(getReplyLengthMetrics('a'.repeat(301))), {
    code: 'REPLY_TOO_LONG',
    message: '回复最多 300 字，当前超过 1 字。',
    maxLength: 300,
    actualLength: 301,
    exceededBy: 1,
  })
})

test('reply length counts Chinese, ASCII and emoji as user-perceived characters', () => {
  assert.equal(getReplyLengthMetrics('中文').actualLength, 2)
  assert.equal(getReplyLengthMetrics('A1!').actualLength, 3)
  assert.equal(getReplyLengthMetrics('😀').actualLength, 1)
  assert.equal(getReplyLengthMetrics('👨‍👩‍👧‍👦').actualLength, 1)
})

test('reply length keeps live input editable while applying trim rules for validation', () => {
  const whitespace = getReplyLengthMetrics(' \n\t ')
  assert.equal(whitespace.content, '')
  assert.equal(whitespace.actualLength, 0)
  const oversized = getReplyLengthMetrics(`${'a'.repeat(300)}超出`)
  assert.equal(oversized.content, `${'a'.repeat(300)}超出`)
  assert.equal(oversized.actualLength, 302)
  assert.equal(oversized.exceededBy, 2)
})
