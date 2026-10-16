import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './fixtures/topic-v2-transaction'
import { topicActivityTestDirty } from '@/lib/topic-activity-test-presentation'
import { saveTopicActivityV2Program } from '@/lib/topic-activity-v2'

test('presentation dirty separates result image and share settings from protected test structure', () => {
  const before = fixture().program.test
  const after = structuredClone(before)
  after.results[0].imageUrl = '/uploads/new-poster.png'
  assert.deepEqual(topicActivityTestDirty(before, after), { TEST_STRUCTURE_DIRTY: false, RESULT_PRESENTATION_DIRTY: true, SHARE_SETTINGS_DIRTY: false })
  after.poster.showQrCode = !before.poster.showQrCode
  assert.deepEqual(topicActivityTestDirty(before, after), { TEST_STRUCTURE_DIRTY: false, RESULT_PRESENTATION_DIRTY: true, SHARE_SETTINGS_DIRTY: true })
  assert.equal(before.results[0].imageUrl, undefined)
})

test('real server save permits image/nickname/QR changes at the same version with historical attempts', async () => {
  for (const setting of ['image', 'nickname', 'qr'] as const) {
    const f = fixture()
    const snapshot = { imageUrl: '/uploads/original.png', title: '历史结果', poster: structuredClone(f.program.test.poster) }
    f.state.attempts.push({ activityId: f.activity.id, testId: f.program.test.id, configVersion: f.program.test.version, resultSnapshot: structuredClone(snapshot) })
    const next = structuredClone(f.program)
    if (setting === 'image') next.test.results[0].imageUrl = '/uploads/new-poster.png'
    if (setting === 'nickname') next.test.poster.showNickname = !next.test.poster.showNickname
    if (setting === 'qr') next.test.poster.showQrCode = !next.test.poster.showQrCode
    const beforeQuestions = structuredClone(f.program.test.questions)
    const saved = await f.run(() => saveTopicActivityV2Program(f.activity.id, 'admin-one', next))
    assert.equal(saved.test.version, next.test.version)
    assert.deepEqual(saved.test.questions, beforeQuestions)
    assert.deepEqual(f.state.attempts[0].resultSnapshot, snapshot, 'presentation saves never mutate historical results or answer snapshots')
  }
})

test('historical attempts still block questions, answer keys, weights and result score ranges', async () => {
  for (const change of ['question', 'answer', 'weights', 'range'] as const) {
    const f = fixture()
    if (change === 'weights') {
      f.program.test.mode = 'PERSONALITY'
      for (const question of f.program.test.questions) {
        delete question.correctOptionId
        question.options.forEach((option) => { option.weights = { low: 0, high: 1 } })
      }
      f.program.test.results.forEach((result) => { delete result.scoreMin; delete result.scoreMax })
    }
    f.state.attempts.push({ activityId: f.activity.id, testId: f.program.test.id, configVersion: f.program.test.version })
    const next = structuredClone(f.program)
    if (change === 'question') next.test.questions[0].prompt = '新题目'
    if (change === 'answer') next.test.questions[0].correctOptionId = 'no'
    if (change === 'weights') next.test.questions[0].options[0].weights = { low: 3, high: 1 }
    if (change === 'range') { next.test.results[0].scoreMax = 0; next.test.results[1].scoreMin = 1 }
    await f.run(() => assert.rejects(saveTopicActivityV2Program(f.activity.id, 'admin-one', next), { code: 'TOPIC_V2_TEST_VERSION_LOCKED' }))
  }
})
