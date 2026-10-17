import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './fixtures/topic-v2-transaction'
import { calculateTopicV2Test } from '@/lib/topic-activity-v2-interactive'
import { normalizeTopicActivityV2Program, publicTopicActivityV2Program, readTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { topicActivityResultReferenceCount } from '@/lib/topic-activity-result-weight-roles'

type OptionSpec = { id: string; weights: Record<string, number> }

function roleTest(specs: Array<{ options: OptionSpec[]; questionWeight?: number }>, resultIds = ['a', 'b', 'c', 'd'], scoringMode: 'LEGACY_WEIGHTED' | 'RESULT_WEIGHT_ROLES_V1' = 'RESULT_WEIGHT_ROLES_V1') {
  const value = structuredClone(fixture().program.test)
  value.enabled = true
  value.mode = 'PERSONALITY'
  value.scoringMode = scoringMode
  value.results = resultIds.map((id) => ({ id, title: `标题 ${id}`, description: `说明 ${id}` }))
  value.questions = specs.map((spec, index) => ({
    id: `q${index + 1}`,
    prompt: `题目 ${index + 1}`,
    points: 0,
    ...(spec.questionWeight === undefined ? {} : { questionWeight: spec.questionWeight }),
    // The role scorer requires every option (including an unselected fixture option)
    // to have exactly one primary result, matching the real editor's defaults.
    options: [...spec.options, { id: `unused-${index + 1}`, weights: { [resultIds[resultIds.length - 1]]: 4 } }].map((option) => ({ ...option, label: option.id })),
  }))
  return value
}

function answersForFirstOptions(value: ReturnType<typeof roleTest>) {
  return Object.fromEntries(value.questions.map((question) => [question.id, question.options[0].id]))
}

test('one option awards primary +4, secondary +2, and weak +1 by stable result ID', () => {
  const value = roleTest([{ options: [{ id: 'selected', weights: { a: 4, b: 2, c: 1 } }] }])
  const result = calculateTopicV2Test(value, { q1: 'selected' })
  assert.deepEqual(result.resultScores, { a: 4, b: 2, c: 1, d: 0 })
  assert.equal(result.result.id, 'a')
})

test('fifteen default-weight questions accumulate role scores exactly', () => {
  const value = roleTest(Array.from({ length: 15 }, (_, index) => ({
    options: [{ id: `selected-${index}`, weights: { a: 4, b: 2, c: 1 } }],
  })))
  const result = calculateTopicV2Test(value, answersForFirstOptions(value))
  assert.deepEqual(result.resultScores, { a: 60, b: 30, c: 15, d: 0 })
  assert.equal(result.result.id, 'a')
})

test('question weight multiplies all selected option result scores', () => {
  const value = roleTest([{ questionWeight: 3, options: [{ id: 'selected', weights: { a: 4, b: 2, c: 1 } }] }])
  const result = calculateTopicV2Test(value, { q1: 'selected' })
  assert.deepEqual(result.resultScores, { a: 12, b: 6, c: 3, d: 0 })
})

test('the result with the highest accumulated total wins', () => {
  const value = roleTest([{ options: [{ id: 'selected', weights: { b: 4, c: 2, d: 1 } }] }])
  assert.equal(calculateTopicV2Test(value, { q1: 'selected' }).result.id, 'b')
})

test('primary assignment count resolves equal total scores before later tie-breakers', () => {
  const value = roleTest([
    { options: [{ id: 'q1', weights: { a: 4, b: 2 } }] },
    { options: [{ id: 'q2', weights: { a: 4, b: 1 } }] },
    { options: [{ id: 'q3', weights: { b: 4, a: 1 } }] },
    { options: [{ id: 'q4', weights: { b: 2 } }] },
  ], ['a', 'b'])
  const result = calculateTopicV2Test(value, { q1: 'q1', q2: 'q2', q3: 'q3', q4: 'q4' })
  assert.deepEqual(result.resultScores, { a: 9, b: 9 })
  assert.equal(result.result.id, 'a')
})

test('scores from the last three questions resolve remaining ties deterministically', () => {
  const value = roleTest([
    { questionWeight: 2, options: [{ id: 'q1', weights: { a: 4 } }] },
    { questionWeight: 2, options: [{ id: 'q2', weights: { b: 4 } }] },
    { options: [{ id: 'q3', weights: { a: 4 } }] },
    { options: [{ id: 'q4', weights: { b: 4 } }] },
  ], ['a', 'b'])
  const result = calculateTopicV2Test(value, { q1: 'q1', q2: 'q2', q3: 'q3', q4: 'q4' })
  assert.deepEqual(result.resultScores, { a: 12, b: 12 })
  assert.equal(result.result.id, 'b')
})

test('configured result order is the final deterministic tie-breaker', () => {
  const value = roleTest([
    { options: [{ id: 'q1', weights: { b: 4 } }] },
    { options: [{ id: 'q2', weights: { a: 4 } }] },
  ], ['b', 'a'])
  assert.equal(calculateTopicV2Test(value, { q1: 'q1', q2: 'q2' }).result.id, 'b')
})

test('renaming a result title preserves option mappings by stable result ID', () => {
  const value = roleTest([{ options: [{ id: 'selected', weights: { 'result-stable': 4, secondary: 2 } }] }], ['result-stable', 'secondary'])
  const config = fixture().program
  config.test = value
  const first = normalizeTopicActivityV2Program(config)
  assert.equal(first.valid, true)
  if (!first.valid) return
  first.value.test.results[0].title = '已修改的标题'
  const second = normalizeTopicActivityV2Program(first.value)
  assert.equal(second.valid, true)
  if (second.valid) assert.deepEqual(second.value.test.questions[0].options[0].weights, { 'result-stable': 4, secondary: 2 })
})

test('deleting a result still referenced by option weights is detectable and guarded', () => {
  const value = roleTest([
    { options: [{ id: 'selected', weights: { a: 4 } }] },
    { options: [{ id: 'also-selected', weights: { a: 2 } }] },
  ])
  assert.equal(topicActivityResultReferenceCount(value.questions, 'a'), 2)
  assert.equal(topicActivityResultReferenceCount(value.questions, 'b'), 0)
})

test('role mappings survive config normalize, JSON persistence, and reload', () => {
  const config = fixture().program
  config.test = roleTest([{ questionWeight: 2, options: [{ id: 'selected', weights: { 'role-a': 4, 'role-b': 2, 'role-c': 1 } }] }], ['role-a', 'role-b', 'role-c'])
  const saved = normalizeTopicActivityV2Program(config)
  assert.equal(saved.valid, true)
  if (!saved.valid) return
  const reloaded = readTopicActivityV2Program(JSON.parse(JSON.stringify(saved.value)))
  assert.ok(reloaded)
  assert.equal(reloaded?.test.scoringMode, 'RESULT_WEIGHT_ROLES_V1')
  assert.equal(reloaded?.test.questions[0].questionWeight, 2)
  assert.deepEqual(reloaded?.test.questions[0].options[0].weights, { 'role-a': 4, 'role-b': 2, 'role-c': 1 })
})

test('public test DTO hides internal scoring mode, question weights, and result mappings', () => {
  const config = fixture().program
  config.test = roleTest([{ questionWeight: 3, options: [{ id: 'selected', weights: { 'role-a': 4, 'role-b': 2 } }] }], ['role-a', 'role-b'])
  const parsed = normalizeTopicActivityV2Program(config)
  assert.equal(parsed.valid, true)
  if (!parsed.valid) return
  const publicTest = publicTopicActivityV2Program(parsed.value).test
  assert.equal('scoringMode' in publicTest, false)
  assert.equal('questionWeight' in publicTest.questions[0], false)
  assert.equal('weights' in publicTest.questions[0].options[0], false)
})

test('legacy configs without scoringMode retain raw-weight resolution and configured-order ties', () => {
  const config = fixture().program
  config.test = roleTest([{ options: [{ id: 'selected', weights: { 'legacy-b': 5, 'legacy-a': 5 } }] }], ['legacy-b', 'legacy-a'], 'LEGACY_WEIGHTED')
  const raw = JSON.parse(JSON.stringify(config)) as { test: Record<string, unknown> }
  delete raw.test.scoringMode
  const parsed = normalizeTopicActivityV2Program(raw)
  assert.equal(parsed.valid, true)
  if (!parsed.valid) return
  assert.equal(parsed.value.test.scoringMode, 'LEGACY_WEIGHTED')
  assert.equal(calculateTopicV2Test(parsed.value.test, { q1: 'selected' }).result.id, 'legacy-b')
})

test('new role mapping validation requires one unique primary per option', () => {
  const invalidMappings: Array<Record<string, number>> = [{ 'invalid-a': 2, 'invalid-b': 2 }, { 'invalid-a': 2 }, { 'invalid-a': 3, 'invalid-b': 4 }]
  for (const weights of invalidMappings) {
    const config = fixture().program
    config.test = roleTest([{ options: [{ id: 'selected', weights }] }], ['invalid-a', 'invalid-b', 'invalid-c'])
    assert.equal(normalizeTopicActivityV2Program(config).valid, false)
  }
})
