import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createTopicWizardDraft } from '../components/activities/TopicActivityWizardState'
import { createWizardMedia, selectWizardImage } from '../components/activities/TopicActivityWizardMedia'
import { createWizardSnapshot, WizardSaveSessionController } from '../components/activities/TopicActivityWizardSession'
import { prepareWizardActivityPayload } from '../components/activities/TopicActivityWizardPayload'
import { saveWizardActivityDraft } from '../components/activities/TopicActivityWizardActivitySave'
import { normalizeActivityInput } from '../lib/activity-validation'
import { normalizeTopicActivityConfig } from '../lib/topic-activity-config'

function fixture() {
  const draft = createTopicWizardDraft()
  Object.assign(draft.activity, { title: '草稿活动', description: '活动介绍', participationRule: '提交截图', startsAt: '2030-10-01T09:00', endsAt: '2030-10-10T18:00' })
  const snapshot = createWizardSnapshot(draft, createWizardMedia(), 3)
  return { draft, snapshot, controller: new WizardSaveSessionController(snapshot.draftId, 'API') }
}
const id = 'activity-fixture-001'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function successTransport(snapshot: ReturnType<typeof fixture>['snapshot'], calls: string[]) {
  return async (path: string, init: RequestInit) => {
    calls.push(`${init.method} ${path}`)
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error')
    assert.ok(init.signal)
    return json({ activity: { ...prepareWizardActivityPayload(snapshot), id } }, init.method === 'POST' ? 201 : 200)
  }
}
test('create success binds ID before readback, only POST activity + GET detail, draft never publishes', async () => {
  const { snapshot, controller } = fixture(), calls: string[] = [], states: ReturnType<typeof controller.getState>[] = []
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport: successTransport(snapshot, calls), onChange: (state) => states.push(state) }), 'CONFIRMED')
  assert.deepEqual(calls, ['POST /api/admin/activities', `GET /api/admin/activities/${id}`])
  assert.ok(states.some((state) => state.activityId === id && state.stages.READBACK === 'IDLE'))
  const state = controller.getState()
  assert.equal(state.activityId, id); assert.equal(state.stages.ACTIVITY, 'SUCCEEDED'); assert.equal(state.stages.READBACK, 'SUCCEEDED')
  assert.equal(state.stages.PROGRAM, 'SKIPPED'); assert.equal(state.stages.LOTTERY, 'SKIPPED'); assert.equal(state.stages.PUBLISH, 'IDLE')
  assert.equal(state.requestLock, null)
  await saveWizardActivityDraft(controller, snapshot, { transport: successTransport(snapshot, calls) })
  assert.equal(calls.filter((call) => call.startsWith('POST')).length, 1)
})
test('double click and repeated clicks while POST or GET pending cannot send a second request', async () => {
  const { snapshot, controller } = fixture(), calls: string[] = []
  let release!: () => void
  const pause = new Promise<void>((resolve) => { release = resolve })
  const transport = async (path: string, init: RequestInit) => {
    calls.push(`${init.method} ${path}`)
    await pause
    return json({ activity: { ...prepareWizardActivityPayload(snapshot), id } }, init.method === 'POST' ? 201 : 200)
  }
  const first = saveWizardActivityDraft(controller, snapshot, { transport })
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport }), 'BLOCKED')
  assert.equal(calls.length, 1)
  release(); assert.equal(await first, 'CONFIRMED')
  assert.equal(calls.filter((call) => call.startsWith('POST')).length, 1)
})
for (const status of [400, 401, 403]) test(`definite API rejection ${status} preserves input, releases lock, never retries automatically`, async () => {
  const { snapshot, controller } = fixture(), before = JSON.stringify(snapshot)
  let calls = 0
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport: async () => { calls++; return json({ message: 'rejected' }, status) } }), 'FAILED')
  assert.equal(calls, 1); assert.equal(controller.getState().error?.stage, 'ACTIVITY')
  assert.equal(controller.getState().activityId, null); assert.equal(controller.getState().requestLock, null)
  assert.equal(JSON.stringify(snapshot), before)
})
for (const failure of ['timeout', 'network', '500', 'bad-json', 'missing-id']) test(`unknown POST ${failure} blocks retry, including late success and snapshot restore`, async () => {
  const { snapshot, controller } = fixture()
  let calls = 0, late!: (value: Response) => void
  const transport = async () => {
    calls++
    if (failure === 'timeout') return new Promise<Response>((resolve) => { late = resolve })
    if (failure === 'network') throw new Error('network')
    if (failure === '500') return json({ message: 'error' }, 500)
    if (failure === 'bad-json') return new Response('<html>', { status: 201 })
    return json({ activity: {} }, 201)
  }
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport, timeoutMs: 5 }), 'UNKNOWN')
  assert.equal(controller.getState().stages.ACTIVITY, 'UNKNOWN')
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport }), 'BLOCKED')
  const restored = WizardSaveSessionController.restore(controller.getCheckpoint())
  assert.equal(await saveWizardActivityDraft(restored, snapshot, { transport }), 'BLOCKED')
  assert.equal(calls, 1)
  if (late) { late(json({ activity: { id } }, 201)); await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(controller.getState().activityId, null) }
})
test('response body timeout is also UNKNOWN and aborts the request', async () => {
  const { snapshot, controller } = fixture()
  let signal: AbortSignal | null = null
  const result = await saveWizardActivityDraft(controller, snapshot, { timeoutMs: 5, transport: async (_, init) => {
    signal = init.signal!
    return { status: 201, json: () => new Promise(() => {}) } as Response
  } })
  assert.equal(result, 'UNKNOWN'); assert.equal((signal as AbortSignal | null)?.aborted, true)
})
test('readback failure retains ID; explicit recovery only GETs original draft, even with changed UI', async () => {
  const { snapshot, controller } = fixture(), calls: string[] = []
  const ok = successTransport(snapshot, calls)
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport: async (path, init) => init.method === 'GET' ? json({}, 503) : ok(path, init) }), 'FAILED')
  assert.equal(controller.getState().activityId, id); assert.equal(controller.getState().error?.stage, 'READBACK')
  const restored = WizardSaveSessionController.restore(controller.getCheckpoint())
  const other = fixture().snapshot
  assert.equal(await saveWizardActivityDraft(restored, other, { transport: ok }), 'CONFIRMED')
  assert.equal(calls.filter((call) => call.startsWith('POST')).length, 1)
  assert.equal(restored.getState().needsReadback, false)
})
test('readback in flight blocks more clicks; GET timeout retains ID and allows only explicit GET recovery', async () => {
  const { snapshot, controller } = fixture(), calls: string[] = []
  let getStarted!: () => void
  const started = new Promise<void>((resolve) => { getStarted = resolve })
  const transport = async (path: string, init: RequestInit) => {
    calls.push(`${init.method} ${path}`)
    if (init.method === 'POST') return json({ activity: { ...prepareWizardActivityPayload(snapshot), id } }, 201)
    getStarted(); return new Promise<Response>(() => {})
  }
  const first = saveWizardActivityDraft(controller, snapshot, { transport, timeoutMs: 30 })
  await started
  assert.equal(controller.getState().activityId, id)
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport }), 'BLOCKED')
  assert.equal(await first, 'FAILED')
  assert.equal(controller.getState().error?.stage, 'READBACK'); assert.equal(controller.getState().activityId, id)
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport: successTransport(snapshot, calls) }), 'CONFIRMED')
  assert.equal(calls.filter((call) => call.startsWith('POST')).length, 1)
})
for (const change of [{ id: 'wrong-record' }, { status: 'PUBLISHED' }, { type: 'OTHER' }, { title: 'changed' }]) test(`readback mismatch ${JSON.stringify(change)} fails closed, preserving created ID`, async () => {
  const { snapshot, controller } = fixture()
  assert.equal(await saveWizardActivityDraft(controller, snapshot, { transport: async (_, init) => json({ activity: { ...prepareWizardActivityPayload(snapshot), id, ...(init.method === 'GET' ? change : {}) } }, init.method === 'POST' ? 201 : 200) }), 'FAILED')
  assert.equal(controller.getState().activityId, id); assert.equal(controller.getState().error?.stage, 'READBACK')
})
test('activity adapter white-lists current contract and excludes future V2/lottery/session/UI properties', async () => {
  const { draft } = fixture()
  draft.lottery.enabled = true // Incomplete future config must not block saving only base activity.
  Object.assign(draft.activity, { id: 'inject', status: 'PUBLISHED', activityReward: { points: 999 }, program: draft.program, config: draft.lottery })
  const snapshot = createWizardSnapshot(draft, createWizardMedia(), 3)
  const payload = prepareWizardActivityPayload(snapshot)
  assert.equal(normalizeActivityInput(payload).valid, true); assert.equal(normalizeTopicActivityConfig(payload, 'TOPIC_ACTIVITY').valid, true)
  assert.equal(payload.status, 'DRAFT'); assert.equal(payload.rewardPoints, null); assert.deepEqual(payload.rewardBadgeIds, [])
  for (const key of ['id', 'activityReward', 'program', 'config', 'lottery', 'identity', 'file', 'metadata', 'requestLock']) assert.equal(key in payload, false)
  const controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  await saveWizardActivityDraft(controller, snapshot, { transport: async (_, init) => {
    if (init.method === 'POST') assert.deepEqual(JSON.parse(init.body as string), payload)
    return json({ activity: { ...payload, id } }, init.method === 'POST' ? 201 : 200)
  } })
})
test('pending cover blocks before any POST; prize-only images remain local', async () => {
  const { draft, controller } = fixture(), media = createWizardMedia()
  media.cover = selectWizardImage(new File(['fixture'], 'cover.png', { type: 'image/png' }))
  let calls = 0
  await assert.rejects(saveWizardActivityDraft(controller, createWizardSnapshot(draft, media, 3), { transport: async () => { calls++; return json({}) } }), /封面尚未上传/)
  assert.equal(calls, 0); assert.equal(controller.getState().requestLock, null)
  media.cover = createWizardMedia().cover; media.prizes.local = selectWizardImage(new File(['fixture'], 'prize.png', { type: 'image/png' }))
  assert.equal(prepareWizardActivityPayload(createWizardSnapshot(draft, media, 3)).status, 'DRAFT')
})
test('phase 2-A transport has no future saves, delete, publish or automatic retries', () => {
  const source = readFileSync('components/activities/TopicActivityWizardActivitySave.ts', 'utf8')
  assert.doesNotMatch(source, /method: '(PATCH|DELETE|PUT)'|\/v2|\/lottery|localStorage|sessionStorage/)
  assert.equal((source.match(/method: 'POST'/g) || []).length, 1)
})
