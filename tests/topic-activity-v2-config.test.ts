import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDefaultTopicActivityV2Program,
  normalizeTopicActivityV2Program,
  publicTopicActivityV2Program,
  readTopicActivityV2Program,
  topicActivityV2PosterBackground,
  TOPIC_ACTIVITY_V2_POSTER_SIZE,
} from '@/lib/topic-activity-v2-config'

function knowledgeProgram(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    enabled: true,
    discussionEnabled: true,
    showRules: true,
    showRewards: true,
    materials: '活动说明',
    platformRewards: { enabled: true, allowStacking: true, maxPlatforms: 2, maxEntries: 3 },
    fixedReward: { enabled: true, type: 'POINTS', points: 10, description: '完成活动', condition: 'APPROVED_COMMENT', requiresReview: true, startsAt: '2026-10-01T10:00', endsAt: '2026-10-31T23:00' },
    medal: { enabled: true, badgeId: 'badge-v2', description: '完成活动', triggers: ['APPROVED_COMMENT'], allowLateReview: true },
    entries: [{ id: 'entry-1', platformKey: 'social', platformName: '社交平台', title: '分享活动', instructions: '按要求提交截图', materialRequirement: '原图', minImages: 1, maxImages: 2, points: 20, enabled: true, sortOrder: 0, startsAt: null, endsAt: null, allowResubmit: true }],
    poll: { enabled: true, id: 'poll-1', version: 1, title: '选择一个', description: '投票说明', mode: 'SINGLE', maxChoices: 1, options: [{ id: 'poll-option-a', label: 'A' }, { id: 'poll-option-b', label: 'B' }], startsAt: null, endsAt: null, allowChange: false, showLiveResults: true, publishAfterClose: false },
    test: { enabled: true, id: 'test-1', version: 1, title: '知识测试', description: '测试说明', mode: 'KNOWLEDGE', allowRetake: false, questions: [{ id: 'question-1', prompt: '题目', points: 1, options: [{ id: 'question-option-a', label: '正确' }, { id: 'question-option-b', label: '错误' }], correctOptionId: 'question-option-a' }], results: [{ id: 'result-0', title: '结果一', description: '结果说明', scoreMin: 0, scoreMax: 0 }, { id: 'result-1', title: '结果二', description: '结果说明', scoreMin: 1, scoreMax: 1 }], poster: { width: 1080, height: 1920, backgroundUrl: '/uploads/topic/poster.png', showNickname: true, showQrCode: true } },
    ...overrides,
  }
}

test('V2 default config is disabled and read(null) does not invent activity config', () => {
  const defaultConfig = createDefaultTopicActivityV2Program()
  assert.equal(defaultConfig.version, 2)
  assert.equal(defaultConfig.enabled, false)
  assert.deepEqual(readTopicActivityV2Program(null), null)
  const normalized = normalizeTopicActivityV2Program(undefined)
  assert.equal(normalized.valid, true)
  if (normalized.valid) {
    assert.equal(normalized.value.enabled, false)
    assert.deepEqual([normalized.value.test.poster.width, normalized.value.test.poster.height], [1080, 1440])
  }
})

test('V5 poster dimensions normalize legacy 9:16 values and resolve one global or legacy background', () => {
  assert.deepEqual(TOPIC_ACTIVITY_V2_POSTER_SIZE, { width: 1080, height: 1440 })
  const legacy = knowledgeProgram({ test: {
    ...knowledgeProgram().test as object,
    results: [
      { id: 'result-0', title: '结果一', description: '结果说明', scoreMin: 0, scoreMax: 0, imageUrl: null },
      { id: 'result-1', title: '结果二', description: '结果说明', scoreMin: 1, scoreMax: 1, imageUrl: '/uploads/topic/legacy-second.png' },
    ],
    poster: { width: 1080, height: 1920, backgroundUrl: null, showNickname: false, showQrCode: false },
  } })
  const normalized = normalizeTopicActivityV2Program(legacy)
  assert.equal(normalized.valid, true)
  if (normalized.valid) {
    assert.deepEqual([normalized.value.test.poster.width, normalized.value.test.poster.height], [1080, 1440])
    assert.equal(normalized.value.test.results[1].imageUrl, '/uploads/topic/legacy-second.png', 'legacy result assets remain intact')
    assert.equal(topicActivityV2PosterBackground(normalized.value.test), '/uploads/topic/legacy-second.png')
  }
  const shared = structuredClone(legacy) as { test: { poster: { backgroundUrl: string | null }; results: Array<{ imageUrl?: string | null }> } }
  shared.test.poster.backgroundUrl = '/uploads/topic/shared.png'
  assert.equal(topicActivityV2PosterBackground(shared.test), '/uploads/topic/shared.png', 'shared background overrides all legacy images')
  assert.equal(topicActivityV2PosterBackground({ poster: { backgroundUrl: '' }, results: [] }), null)
})

test('V2 config normalizes Beijing datetime-local input to ISO instants', () => {
  const normalized = normalizeTopicActivityV2Program(knowledgeProgram())
  assert.equal(normalized.valid, true)
  if (!normalized.valid) return
  assert.equal(normalized.value.fixedReward.startsAt, '2026-10-01T02:00:00.000Z')
  assert.equal(normalized.value.fixedReward.endsAt, '2026-10-31T15:00:00.000Z')
  assert.equal(normalized.value.test.poster.backgroundUrl, '/uploads/topic/poster.png')
})

test('timezone-less seconds use Asia/Shanghai even when the host timezone differs', () => {
  const normalized = normalizeTopicActivityV2Program(knowledgeProgram({
    fixedReward: { ...knowledgeProgram().fixedReward as object, startsAt: '2026-10-01 10:00:05.125' },
  }))
  assert.equal(normalized.valid, true)
  if (normalized.valid) assert.equal(normalized.value.fixedReward.startsAt, '2026-10-01T02:00:05.125Z')
})

test('V2 IDs are unique and references remain inside their collection', () => {
  const duplicateEntry = knowledgeProgram({ entries: [
    { id: 'entry-1', platformKey: 'one', platformName: '一', title: '一', instructions: '一', materialRequirement: '', minImages: 0, maxImages: 0, points: 0, enabled: true, sortOrder: 0, startsAt: null, endsAt: null, allowResubmit: false },
    { id: 'entry-1', platformKey: 'two', platformName: '二', title: '二', instructions: '二', materialRequirement: '', minImages: 0, maxImages: 0, points: 0, enabled: true, sortOrder: 1, startsAt: null, endsAt: null, allowResubmit: false },
  ] })
  const duplicateResult = normalizeTopicActivityV2Program(duplicateEntry)
  assert.equal(duplicateResult.valid, false)

  const badAnswer = knowledgeProgram({ test: {
    ...knowledgeProgram().test as object,
    questions: [{ id: 'question-1', prompt: '题目', points: 1, options: [{ id: 'question-option-a', label: 'A' }, { id: 'question-option-b', label: 'B' }], correctOptionId: 'missing' }],
  } })
  const badAnswerResult = normalizeTopicActivityV2Program(badAnswer)
  assert.equal(badAnswerResult.valid, false)
})

test('knowledge result ranges must cover the whole score without overlap or gaps', () => {
  const gap = knowledgeProgram({ test: {
    ...knowledgeProgram().test as object,
    results: [{ id: 'result-0', title: '结果一', description: '说明', scoreMin: 0, scoreMax: 0 }, { id: 'result-1', title: '结果二', description: '说明', scoreMin: 2, scoreMax: 2 }],
  } })
  const result = normalizeTopicActivityV2Program(gap)
  assert.equal(result.valid, false)
})

test('personality weights reference declared results and are removed from public config', () => {
  const personality = knowledgeProgram({ test: {
    enabled: true,
    id: 'personality-test',
    version: 2,
    title: '趣味测试',
    description: '说明',
    mode: 'PERSONALITY',
    allowRetake: true,
    questions: [{ id: 'personality-question', prompt: '选择', points: 0, options: [
      { id: 'personality-option-a', label: 'A', weights: { 'personality-result-a': 2 } },
      { id: 'personality-option-b', label: 'B', weights: { 'personality-result-b': 1 } },
    ] }],
    results: [
      { id: 'personality-result-a', title: 'A', description: 'A' },
      { id: 'personality-result-b', title: 'B', description: 'B' },
    ],
    poster: { width: 1080, height: 1920, backgroundUrl: null, showNickname: true, showQrCode: false },
  } })
  const normalized = normalizeTopicActivityV2Program(personality)
  assert.equal(normalized.valid, true)
  if (!normalized.valid) return
  const publicConfig = publicTopicActivityV2Program(normalized.value)
  const question = publicConfig.test.questions[0]
  assert.equal('correctOptionId' in question, false)
  assert.equal('weights' in question.options[0], false)
  const internalQuestion = normalized.value.test.questions[0]
  assert.deepEqual(internalQuestion.options[0].weights, { 'personality-result-a': 2 })
})

test('unsafe poster URLs and malformed times are rejected', () => {
  const unsafePoster = knowledgeProgram({ test: { ...knowledgeProgram().test as object, poster: { width: 1080, height: 1920, backgroundUrl: 'https://evil.example/poster.png', showNickname: true, showQrCode: false } } })
  assert.equal(normalizeTopicActivityV2Program(unsafePoster).valid, false)
  const malformedTime = knowledgeProgram({ fixedReward: { ...knowledgeProgram().fixedReward as object, startsAt: '2026-02-31T10:00' } })
  assert.equal(normalizeTopicActivityV2Program(malformedTime).valid, false)
})
test('reward caps bound successful claims, not the number of available configured tasks', () => {
  const entry = knowledgeProgram().entries[0]
  const program = knowledgeProgram({ platformRewards: { enabled: true, allowStacking: true, maxPlatforms: 1, maxEntries: 1 }, entries: [entry, { ...entry, id: 'entry-2', platformKey: 'other' }] })
  assert.equal(normalizeTopicActivityV2Program(program).valid, true)
})
