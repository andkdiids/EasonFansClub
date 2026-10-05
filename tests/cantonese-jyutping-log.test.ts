import assert from 'node:assert/strict'
import test from 'node:test'
import { cantoneseJyutpingReviewDigest, isLatestJyutpingVerification, isCantoneseJyutpingReviewed, jyutpingVerificationReason, jyutpingReviewLogView } from '../lib/cantonese-jyutping-review'

test('new confirmation captures the reviewed value while keeping legacy hash events compatible', () => {
  const digest = cantoneseJyutpingReviewDigest('早晨', 'zou2 san4')!
  const legacy = { action: 'VERIFY_JYUTPING', reason: digest }
  const current = { action: 'VERIFY_JYUTPING', reason: jyutpingVerificationReason('早晨', 'zou2 san4') }
  assert.equal(isLatestJyutpingVerification([legacy], digest), true)
  assert.equal(isLatestJyutpingVerification([current], digest), true)
  assert.equal(isCantoneseJyutpingReviewed({ text: '早晨', jyutping: 'zou2 san4', verificationReason: current.reason }), true)
  assert.equal(isCantoneseJyutpingReviewed({ text: '早晨', jyutping: 'zou2 san2', verificationReason: current.reason }), false)
  const shown = jyutpingReviewLogView(current, 'changed', 'different1')
  assert.equal(shown.jyutping, 'zou2 san4')
  assert.equal(shown.jyutpingValueSource, 'RECORDED')
  assert.equal(shown.reason, '粤拼核对记录')
})

test('historical final Jyutping is shown only when current pair matches its hash', () => {
  const reason = cantoneseJyutpingReviewDigest('早晨', 'zou2 san4')!
  const event = { action: 'VERIFY_JYUTPING', reason }
  assert.equal(jyutpingReviewLogView(event, '早晨', 'zou2 san4').jyutping, 'zou2 san4')
  const unknown = jyutpingReviewLogView(event, '新文本', 'san1')
  assert.equal(unknown.jyutping, null)
  assert.equal(unknown.jyutpingValueSource, 'UNAVAILABLE')
})

test('mixed-format latest revoke wins, and changing pronunciation never inherits verification', () => {
  const digest = cantoneseJyutpingReviewDigest('早晨', 'zou2 san4')!
  const verified = { action: 'VERIFY_JYUTPING', reason: digest, createdAt: '2026-10-05T01:00:00Z' }
  const revoked = { action: 'REVOKE_JYUTPING', reason: jyutpingVerificationReason('早晨', 'zou2 san4'), createdAt: '2026-10-05T02:00:00Z' }
  assert.equal(isLatestJyutpingVerification([verified, revoked], digest), false)
  assert.equal(isLatestJyutpingVerification([verified], cantoneseJyutpingReviewDigest('早晨', 'zou2 san2')), false)
})

test('edit logs disclose actual before/after only when they were recorded', () => {
  const event = { action: 'EDIT', reason: JSON.stringify({ kind: 'JYUTPING_EDIT', beforeJyutping: null, afterJyutping: 'gan6 paai4 dim2 aa3' }) }
  const shown = jyutpingReviewLogView(event, '', null)
  assert.ok('beforeJyutping' in shown)
  assert.equal(shown.beforeJyutping, null)
  assert.equal(shown.afterJyutping, 'gan6 paai4 dim2 aa3')
  const legacy = jyutpingReviewLogView({ action: 'EDIT', reason: null }, '', null)
  assert.equal(legacy.jyutpingValueSource, 'UNAVAILABLE')
  assert.equal('beforeJyutping' in legacy, false)
})
