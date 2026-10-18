import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, instant } from './fixtures/topic-v2-transaction'
import { normalizeTopicActivityV2Program, publicTopicActivityV2Program, topicResultDescriptionVariants } from '@/lib/topic-activity-v2-config'
import { getTopicV2Attempt, getTopicV2Attempts, getTopicV2PosterSnapshot, selectTopicResultDescription, submitTopicV2Test } from '@/lib/topic-activity-v2-interactive'
import { prisma } from '@/lib/prisma'

const variants = [{ id: 'description-a', text: '说明 A' }, { id: 'description-b', text: '说明 B' }, { id: 'description-c', text: '说明 C' }]
const input = { activityId: 'activity-one', userId: 'user-one', answers: { q1: 'yes' }, requestKey: 'request-one', now: instant }

test('legacy single description keeps text and a stable identity independent of text/order', () => {
  const result = fixture().program.test.results[1]
  const [legacy] = topicResultDescriptionVariants(result)
  assert.equal(legacy.text, result.description)
  assert.equal(topicResultDescriptionVariants({ ...result, description: '新文案' })[0].id, legacy.id)
  assert.deepEqual(selectTopicResultDescription(result), legacy)
})

test('variant save/reload trims and filters blanks while preserving stable IDs and order', () => {
  const f = fixture()
  f.program.test.results[1].descriptionVariants = [variants[2], { id: 'empty-description', text: '   ' }, { ...variants[0], text: '  说明 A  ' }, variants[1]]
  const saved = normalizeTopicActivityV2Program(f.program)
  assert.equal(saved.valid, true)
  if (!saved.valid) return
  assert.deepEqual(saved.value.test.results[1].descriptionVariants, [variants[2], variants[0], variants[1]])
  assert.equal(saved.value.test.results[1].description, '说明 C')
  assert.deepEqual(normalizeTopicActivityV2Program(JSON.parse(JSON.stringify(saved.value))), saved)
  assert.equal('descriptionVariants' in publicTopicActivityV2Program(saved.value).test.results[1], false)
})

for (const invalid of [[], [{ id: 'empty', text: '   ' }], [{ id: 'same', text: 'A' }, { id: 'same', text: 'B' }], [{ id: '', text: 'A' }]]) {
  test(`invalid variant configuration is rejected: ${JSON.stringify(invalid)}`, () => {
    const f = fixture(); f.program.test.results[1].descriptionVariants = invalid
    assert.equal(normalizeTopicActivityV2Program(f.program).valid, false)
  })
}

test('uniform selector samples a variant index without changing the result/scoring algorithm', () => {
  const result = { id: 'result-one', title: '尘大师', description: '旧文案', descriptionVariants: variants }
  for (let index = 0; index < variants.length; index++) {
    assert.deepEqual(selectTopicResultDescription(result, (max) => { assert.equal(max, variants.length); return index }), variants[index])
  }
  assert.deepEqual(result.descriptionVariants, variants)
})

test('attempt snapshot freezes selected variant across ten reads, replay, history, edits, deletion and poster', async () => {
  const f = fixture(); f.program.test.results[1].descriptionVariants = structuredClone(variants)
  await f.run(async () => {
    const first = await submitTopicV2Test(input)
    const frozen = structuredClone(first.attempt.resultSnapshot)
    const snapshot = frozen as { description: string; descriptionVariantId: string }
    assert.ok(variants.some((variant) => variant.id === snapshot.descriptionVariantId && variant.text === snapshot.description))
    f.program.test.results[1].description = '管理员改后的第一条'
    f.program.test.results[1].descriptionVariants = [{ id: 'replacement', text: '管理员替换并删除旧说明' }]
    for (let count = 0; count < 10; count++) {
      assert.deepEqual((await getTopicV2Attempt(f.activity.id, first.attempt.id, input.userId)).resultSnapshot, frozen)
      assert.deepEqual((await getTopicV2Attempts(f.activity.id, input.userId))[0].resultSnapshot, frozen)
      assert.deepEqual((await submitTopicV2Test(input)).attempt.resultSnapshot, frozen)
    }
    const original = prisma.topicActivityTestAttempt.findFirst
    try {
      Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', async () => ({ ...f.state.attempts[0], Activity: f.activity, User: { nickname: '用户', avatarUrl: null, Profile: null } }))
      const poster = await getTopicV2PosterSnapshot(f.activity.id, first.attempt.id, input.userId)
      assert.equal(poster.description, snapshot.description)
      assert.equal(poster.descriptionVariantId, snapshot.descriptionVariantId)
    } finally { Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', original) }
    assert.equal(f.state.attempts.length, 1)
  })
})

test('retake creates another independent snapshot while retaining the previous one', async () => {
  const f = fixture(); f.program.test.results[1].descriptionVariants = [variants[0]]
  await f.run(async () => {
    const first = await submitTopicV2Test(input)
    f.program.test.results[1].descriptionVariants = [variants[1]]
    const second = await submitTopicV2Test({ ...input, requestKey: 'request-two' })
    assert.notEqual(first.attempt.id, second.attempt.id)
    assert.equal((first.attempt.resultSnapshot as { description: string }).description, '说明 A')
    assert.equal((second.attempt.resultSnapshot as { description: string }).description, '说明 B')
    assert.deepEqual((await getTopicV2Attempt(f.activity.id, first.attempt.id, input.userId)).resultSnapshot, first.attempt.resultSnapshot)
  })
})
