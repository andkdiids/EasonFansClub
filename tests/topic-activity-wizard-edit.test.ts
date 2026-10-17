import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultTopicActivityV2Program } from '../lib/topic-activity-v2-config'
import { defaultTopicLotteryConfig } from '../lib/topic-activity-v2-lottery-config'
import { topicWizardEditInitialState, getTopicWizardEditChanges, saveTopicWizardEdits } from '../components/activities/TopicActivityWizardEdit'
import type { TopicActivityV2Program } from '../lib/topic-activity-v2-config'
import type { TopicLotteryConfig } from '../lib/topic-activity-v2-lottery-config'

const activityId = 'activity-edit-fixture'
const activityRow = () => ({ id: activityId, type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', title: '原活动', description: '原介绍',
  coverUrl: 'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/activities/fixture/source.webp',
  startsAt: '2030-10-01T01:00:00.000Z', endsAt: '2030-10-10T10:00:00.000Z', participationRule: '原参与规则',
  participationMode: 'COMMENT', allowImageAttachments: true })

function fixture(testParticipants = 0) {
  const program = createDefaultTopicActivityV2Program()
  program.enabled = true
  const lottery = defaultTopicLotteryConfig()
  const activity = activityRow()
  const initial = topicWizardEditInitialState({ activity }, { activity, program, statistics: { testParticipants } },
    { config: lottery, configLocked: false, addressEncryptionReady: true }, activityId)
  return { ...initial, activity, program: initial.baseline.program, lottery: initial.baseline.lottery }
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function memoryTransport(state: { activity: Record<string, unknown>; program: TopicActivityV2Program; lottery: TopicLotteryConfig }, calls: string[], options: {
  onGet?: (path: string) => unknown | undefined
  beforePatch?: (path: string, body: unknown) => Response | Error | undefined
  testParticipants?: number
} = {}) {
  return async (path: string, init: RequestInit) => {
    const method = init.method || 'GET'
    calls.push(`${method} ${path}`)
    if (method === 'GET') {
      const override = options.onGet?.(path)
      if (override !== undefined) return response(override)
      if (path === `/api/admin/activities/${activityId}`) return response({ activity: state.activity })
      if (path.endsWith('/v2/lottery')) return response({ config: state.lottery, configLocked: false, addressEncryptionReady: true, draw: null, winners: [] })
      // Real V2 activity summary deliberately omits type; identity comes from Activity detail.
      if (path.endsWith('/v2')) return response({ activity: { id: state.activity.id, title: state.activity.title, status: state.activity.status }, program: state.program, statistics: { testParticipants: options.testParticipants ?? 0 } })
      return response({}, 404)
    }
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
    const interception = options.beforePatch?.(path, body)
    if (interception instanceof Error) throw interception
    if (interception) return interception
    if (path === `/api/admin/activities/${activityId}`) {
      state.activity = { ...state.activity, ...body }
      return response({ activity: state.activity })
    }
    if (path.endsWith('/v2/lottery')) {
      state.lottery = body.config as TopicLotteryConfig
      return response({ config: state.lottery })
    }
    if (path.endsWith('/v2')) {
      state.program = body.program as TopicActivityV2Program
      return response({ program: state.program })
    }
    return response({}, 404)
  }
}

test('EDIT hydrates server activity, V2 test, lottery and existing cover without losing IDs', () => {
  const value = fixture()
  value.program.entries = [{ id: 'stable-task-id', platformKey: 'weibo', platformName: '微博', title: '分享', instructions: '发布', materialRequirement: '',
    minImages: 1, maxImages: 2, points: 7, enabled: true, sortOrder: 4, startsAt: null, endsAt: null, allowResubmit: true }]
  const next = topicWizardEditInitialState({ activity: value.activity }, { activity: value.activity, program: value.program, statistics: { testParticipants: 0 } },
    { config: value.lottery, configLocked: false, addressEncryptionReady: true }, activityId)
  assert.equal(next.draft.activity.title, '原活动')
  assert.equal(next.draft.activity.startsAt, '2030-10-01T09:00')
  assert.equal(next.media.cover.status, 'UPLOADED')
  assert.equal(next.draft.program.entries[0].id, 'stable-task-id')
  assert.equal(next.draft.identity.platformTaskIds.weibo, 'stable-task-id')
})

test('unchanged EDIT submits no write and does not normalize existing fields', () => {
  const value = fixture()
  const changes = getTopicWizardEditChanges(value.baseline, value.draft, value.media)
  assert.deepEqual(changes.activityPatch, {})
  assert.equal(changes.programChanged, false)
  assert.equal(changes.lotteryChanged, false)
  const calls: string[] = []
  return saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media,
    transport: memoryTransport({ activity: value.activity, program: value.program, lottery: value.lottery }, calls) }).then((result) => {
      assert.equal(result.status, 'NO_CHANGES')
      assert.deepEqual(calls, [])
    })
})

test('EDIT patches only changed activity fields, preserves status and unrelated concurrent data', async () => {
  const value = fixture()
  value.draft.activity.description = '新介绍'
  const state = { activity: { ...value.activity, title: '另一管理员的标题' }, program: value.program, lottery: value.lottery }
  const calls: string[] = []
  const result = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media,
    transport: memoryTransport(state, calls) })
  assert.equal(result.status, 'SAVED')
  assert.deepEqual(calls, [
    `GET /api/admin/activities/${activityId}`,
    `PATCH /api/admin/activities/${activityId}`,
    `GET /api/admin/activities/${activityId}`,
  ])
  assert.equal(state.activity.description, '新介绍')
  assert.equal(state.activity.title, '另一管理员的标题')
  assert.equal(state.activity.status, 'PUBLISHED')
  assert.equal(result.baseline.activity.title, '另一管理员的标题')
})

test('same-field concurrent activity edit conflicts before PATCH', async () => {
  const value = fixture()
  value.draft.activity.title = '我的标题'
  const state = { activity: { ...value.activity, title: '并发新标题' }, program: value.program, lottery: value.lottery }
  const calls: string[] = []
  const result = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media,
    transport: memoryTransport(state, calls) })
  assert.equal(result.status, 'CONFLICT')
  assert.equal(calls.some((call) => call.startsWith('PATCH ')), false)
})

test('program-only EDIT preserves test identifiers and does not PATCH activity or lottery', async () => {
  const value = fixture()
  value.draft.program.test.title = '新测试标题'
  const state = { activity: value.activity, program: value.program, lottery: value.lottery }
  const calls: string[] = []
  const result = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media,
    transport: memoryTransport(state, calls) })
  assert.equal(result.status, 'SAVED')
  assert.equal(state.program.test.id, value.baseline.program.test.id)
  assert.equal(calls.filter((call) => call.startsWith('PATCH ')).length, 1)
  assert.ok(calls.every((call) => !call.startsWith(`PATCH /api/admin/activities/${activityId}`) || call.includes('/v2')))
  assert.equal(calls.some((call) => call.includes('/v2/lottery')), false)
})

test('lottery-only EDIT checks live lock/encryption and stops when lock appeared after initial read', async () => {
  const value = fixture()
  value.draft.lottery.description = '更新说明'
  const calls: string[] = []
  const transport = memoryTransport({ activity: value.activity, program: value.program, lottery: value.lottery }, calls, {
    onGet(path) { return path.endsWith('/v2/lottery') ? { config: value.lottery, configLocked: true, addressEncryptionReady: true, draw: null, winners: [] } : undefined },
  })
  const result = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media, transport })
  assert.equal(result.status, 'BLOCKED')
  assert.equal(calls.some((call) => call.startsWith('PATCH ')), false)
})

test('existing test attempts are saved under an automatic version bump with the stable test ID', async () => {
  const value = fixture(3)
  const testConfig = value.draft.program.test
  testConfig.enabled = true; testConfig.title = '知识测试'
  testConfig.results = [{ id: 'result-stable', title: '正确', description: '结果', scoreMin: 0, scoreMax: 1 }]
  testConfig.questions = [{ id: 'question-stable', prompt: '原题', points: 1, correctOptionId: 'option-a', options: [{ id: 'option-a', label: 'A' }, { id: 'option-b', label: 'B' }] }]
  value.draft.program.test = structuredClone(testConfig)
  value.baseline.program.test = structuredClone(testConfig)
  value.program.test = structuredClone(testConfig)
  value.draft.program.test.questions[0].prompt = '改题'
  const oldAttempt = { testId: testConfig.id, configVersion: testConfig.version, resultId: 'result-stable', resultSnapshot: { title: '旧标题', description: '旧结果' } }
  const history = structuredClone(oldAttempt)
  const calls: string[] = []
  const state = { activity: value.activity, program: value.program, lottery: value.lottery }
  const result = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media,
    transport: memoryTransport(state, calls, { testParticipants: 3 }) })
  assert.equal(result.status, 'SAVED')
  assert.equal(state.program.test.id, testConfig.id)
  assert.equal(state.program.test.version, testConfig.version + 1)
  assert.equal(state.program.test.questions[0].prompt, '改题')
  assert.equal(state.activity.status, 'PUBLISHED')
  assert.deepEqual(history, oldAttempt, 'the prior attempt snapshot remains untouched')
  assert.deepEqual(calls.filter((call) => call.startsWith('PATCH ')), [`PATCH /api/admin/activities/${activityId}/v2`])
})

test('live attempt count appearing after initial EDIT read still causes a safe version bump before PATCH', async () => {
  const value = fixture(0)
  const testConfig = value.draft.program.test
  testConfig.enabled = true; testConfig.title = '知识测试'
  testConfig.results = [{ id: 'live-result', title: '结果', description: '说明', scoreMin: 0, scoreMax: 1 }]
  testConfig.questions = [{ id: 'live-question', prompt: '原题', points: 1, correctOptionId: 'live-a', options: [{ id: 'live-a', label: 'A' }, { id: 'live-b', label: 'B' }] }]
  value.draft.program.test = structuredClone(testConfig)
  value.baseline.program.test = structuredClone(testConfig)
  value.program.test = structuredClone(testConfig)
  value.draft.program.test.questions[0].prompt = '并发前新增答题后的改题'
  const state = { activity: value.activity, program: value.program, lottery: value.lottery }
  const calls: string[] = []
  const result = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media,
    transport: memoryTransport(state, calls, { testParticipants: 3 }) })
  assert.equal(result.status, 'SAVED')
  assert.equal(state.program.test.version, testConfig.version + 1)
  assert.equal(state.program.test.id, testConfig.id)
})

test('existing test attempts allow result poster and QR saves without version bump or question changes', async () => {
  const value = fixture(3)
  value.draft.program.test.results = [{ id: 'poster-result', title: '结果', description: '说明' }]
  value.baseline.program.test = structuredClone(value.draft.program.test)
  value.program.test = structuredClone(value.draft.program.test)
  value.draft.program.test.results[0].imageUrl = '/uploads/new-result.png'
  value.draft.program.test.poster.showQrCode = true
  const changes = getTopicWizardEditChanges(value.baseline, value.draft, value.media)
  assert.deepEqual(changes.testDirty, { TEST_STRUCTURE_DIRTY: false, RESULT_PRESENTATION_DIRTY: true, SHARE_SETTINGS_DIRTY: true })
  const state = { activity: value.activity, program: value.program, lottery: value.lottery }
  const calls: string[] = []
  const result = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media,
    transport: memoryTransport(state, calls, { onGet: (path) => path.endsWith('/v2') ? { activity: state.activity, program: state.program, statistics: { testParticipants: 3 } } : undefined }) })
  assert.equal(result.status, 'SAVED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
  assert.deepEqual(state.program.test.questions, value.baseline.program.test.questions)
  assert.equal(state.program.test.version, value.baseline.program.test.version)
  assert.equal(state.program.test.poster.backgroundUrl, value.baseline.program.test.poster.backgroundUrl)
})

test('legacy activity with nullable dates/rules saves poster-only changes using the real V2 summary and can save again after reload', async () => {
  const value = fixture(3)
  Object.assign(value.activity, { startsAt: null, endsAt: null, participationRule: null, description: '' })
  value.program.test.results = [{ id: 'stable-result', title: '结果', description: '说明' }]
  const initial = topicWizardEditInitialState({ activity: value.activity }, { program: value.program, statistics: { testParticipants: 3 } }, { config: value.lottery }, activityId)
  initial.draft.program.test.results[0].imageUrl = '/uploads/result-background.png'
  initial.draft.program.test.poster.backgroundUrl = '/uploads/legacy-background.png'
  initial.draft.program.test.poster.showNickname = false
  initial.draft.program.test.poster.showQrCode = true
  const state = { activity: value.activity, program: value.program, lottery: value.lottery }
  const calls: string[] = []
  const transport = memoryTransport(state, calls)
  const saved = await saveTopicWizardEdits({ activityId, ...initial, transport })
  assert.equal(saved.status, 'SAVED')
  assert.deepEqual(saved.completed, ['PROGRAM'])
  assert.ok(calls.includes(`GET /api/admin/activities/${activityId}`), 'identity is checked against canonical detail, not missing V2 type')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
  assert.equal(state.program.test.results[0].imageUrl, '/uploads/result-background.png')
  assert.equal(state.activity.startsAt, null)
  const reloaded = topicWizardEditInitialState({ activity: state.activity }, { program: state.program, statistics: { testParticipants: 3 } }, { config: state.lottery }, activityId)
  assert.equal(reloaded.draft.program.test.poster.backgroundUrl, '/uploads/legacy-background.png')
  assert.equal(reloaded.draft.program.test.poster.showQrCode, true)
  reloaded.draft.program.test.poster.showQrCode = false
  assert.equal((await saveTopicWizardEdits({ activityId, ...reloaded, transport })).status, 'SAVED')
  assert.equal(state.program.test.poster.showQrCode, false)
})

test('edit validates changed title/date inputs without requiring untouched nullable legacy fields', () => {
  const value = fixture()
  value.draft.activity.title = ' '
  assert.throws(() => getTopicWizardEditChanges(value.baseline, value.draft, value.media), /活动名称/)
  value.draft.activity.title = value.baseline.activity.title
  value.draft.activity.startsAt = 'not-a-date'
  assert.throws(() => getTopicWizardEditChanges(value.baseline, value.draft, value.media), /开始时间格式/)
  value.draft.activity.startsAt = '2030-11-01T10:00'
  assert.throws(() => getTopicWizardEditChanges(value.baseline, value.draft, value.media), /结束时间必须晚于/)
})

test('unknown PATCH result is read-only on retry and never resubmits', async () => {
  const value = fixture()
  value.draft.activity.title = '新标题'
  const state = { activity: value.activity, program: value.program, lottery: value.lottery }
  const calls: string[] = []
  const transport = memoryTransport(state, calls, { beforePatch: () => new Error('connection lost after request') })
  const first = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media, transport })
  assert.equal(first.status, 'UNKNOWN')
  assert.ok(first.pendingVerification)
  const beforeRetry = calls.filter((call) => call.startsWith('PATCH')).length
  const second = await saveTopicWizardEdits({ activityId, baseline: value.baseline, draft: value.draft, media: value.media,
    pendingVerification: first.pendingVerification, transport })
  assert.equal(second.status, 'UNKNOWN')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, beforeRetry)
})

test('wrong activity ID and cancelled activity are blocked without transport', async () => {
  const value = fixture()
  const calls: string[] = []
  const transport = memoryTransport({ activity: value.activity, program: value.program, lottery: value.lottery }, calls)
  const wrong = await saveTopicWizardEdits({ activityId: 'other-activity', baseline: value.baseline, draft: value.draft, media: value.media, transport })
  assert.equal(wrong.status, 'BLOCKED')
  const cancelled = { ...value.baseline, activity: { ...value.baseline.activity, status: 'CANCELLED' } }
  const result = await saveTopicWizardEdits({ activityId, baseline: cancelled, draft: value.draft, media: value.media, transport })
  assert.equal(result.status, 'BLOCKED')
  assert.deepEqual(calls, [])
})
