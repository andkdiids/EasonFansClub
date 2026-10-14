import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { defaultTopicLotteryConfig } from '../lib/topic-activity-v2-lottery-config'
import { createDefaultTopicActivityV2Program } from '../lib/topic-activity-v2-config'
import { createTopicWizardDraft, toggleTopicWizardPlatform } from '../components/activities/TopicActivityWizardState'
import { createWizardId } from '../components/activities/TopicActivityWizardIds'
import { beginWizardImageUpload, createWizardMedia, selectWizardImage, settleWizardImageUpload } from '../components/activities/TopicActivityWizardMedia'
import { createWizardSnapshot, WizardSaveSessionController } from '../components/activities/TopicActivityWizardSession'
import { prepareWizardActivityPayload, prepareWizardProgramPayload, prepareWizardLotteryPayload } from '../components/activities/TopicActivityWizardPayload'
import { saveWizardActivityDraft } from '../components/activities/TopicActivityWizardActivitySave'
import { saveWizardProgram } from '../components/activities/TopicActivityWizardProgramSave'
import { saveWizardLottery, wizardLotteriesMatch } from '../components/activities/TopicActivityWizardLotterySave'

const id = 'wizard-lottery-activity'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
async function fixture(withProgram = true) {
  const draft = toggleTopicWizardPlatform(createTopicWizardDraft(), 'weibo'), media = createWizardMedia()
  Object.assign(draft.activity, { title: '抽奖草稿', description: '活动介绍', participationRule: '提交截图并审核', startsAt: '2030-10-01T09:00', endsAt: '2030-10-10T18:00' })
  Object.assign(draft.lottery, { enabled: true, drawAt: '2030-10-11T18:00', addressDeadline: '2030-10-18T18:00', prizes: [{ id: createWizardId('prize'), name: '纪念礼物', description: '', imageUrl: null, quantity: 3, sortOrder: 0 }] })
  const snapshot = createWizardSnapshot(draft, media, 3), controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  const activity = { ...prepareWizardActivityPayload(snapshot), id }
  await saveWizardActivityDraft(controller, snapshot, { transport: async (_, init) => json({ activity }, init.method === 'POST' ? 201 : 200) })
  if (withProgram) {
    let program = createDefaultTopicActivityV2Program()
    await saveWizardProgram(controller, snapshot, { transport: async (path, init) => {
      if (!path.endsWith('/v2')) return json({ activity })
      if (init.method === 'PATCH') { program = JSON.parse(init.body as string).program; return json({ program }) }
      return json({ activity, canReview: true, program })
    } })
  }
  return { draft, media, snapshot, controller, activity }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const view = (config: unknown = defaultTopicLotteryConfig()) => ({ config, configLocked: false, addressEncryptionReady: true, state: 'DISABLED', candidateCount: 0, pendingSubmissionCount: 0, draw: null, winners: [], canShip: false })
function transportFor(value: Fixture, calls: string[], initial: unknown = defaultTopicLotteryConfig()) {
  let config = initial
  return async (path: string, init: RequestInit) => {
    calls.push(`${init.method} ${path}`)
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error')
    if (path.endsWith('/v2/lottery')) {
      if (init.method === 'PATCH') { const body = JSON.parse(init.body as string); assert.deepEqual(Object.keys(body), ['config']); config = body.config; return json({ config }) }
      return json({ ...view(config), state: (config as { enabled?: boolean }).enabled ? 'NOT_STARTED' : 'DISABLED' })
    }
    if (path.endsWith('/v2')) return json({ activity: value.activity, canReview: true, ...prepareWizardProgramPayload(value.snapshot) })
    return json({ activity: value.activity })
  }
}
test('lottery success uses own activity + confirmed program, PATCH whitelist then GET exact readback', async () => {
  const value = await fixture(), calls: string[] = []
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: transportFor(value, calls) }), 'CONFIRMED')
  assert.deepEqual(calls, [`GET /api/admin/activities/${id}`, `GET /api/admin/activities/${id}/v2`, `GET /api/admin/activities/${id}/v2/lottery`, `PATCH /api/admin/activities/${id}/v2/lottery`, `GET /api/admin/activities/${id}/v2/lottery`])
  const state = value.controller.getState()
  assert.equal(state.activityId, id); assert.equal(state.stages.LOTTERY, 'SUCCEEDED'); assert.equal(state.lotterySave.readback, 'SUCCEEDED')
  assert.equal(state.stages.PUBLISH, 'IDLE'); assert.equal(state.requestLock, null)
})
test('lottery disabled skips locally without GET/PATCH and does not disable existing configuration', async () => {
  const value = await fixture(); value.draft.lottery.enabled = false
  let calls = 0
  assert.equal(await saveWizardLottery(value.controller, createWizardSnapshot(value.draft, value.media, 3), { transport: async () => { calls++; return json({}) } }), 'SKIPPED')
  assert.equal(calls, 0); assert.equal(value.controller.getState().stages.LOTTERY, 'SKIPPED')
  assert.equal(value.controller.getState().lotterySave.readback, 'SKIPPED')
})
for (const broken of ['empty-prizes', 'no-sources', 'foreign-source', 'zero-stock', 'duplicate-prize', 'disabled-source']) test(`invalid pool/source ${broken} fails before network, preserving input`, async () => {
  const value = await fixture()
  if (broken === 'empty-prizes') value.draft.lottery.prizes = []
  if (broken === 'no-sources') value.draft.lottery.sourceEntryIds = []
  if (broken === 'foreign-source') value.draft.lottery.sourceEntryIds = ['foreign-entry']
  if (broken === 'zero-stock') value.draft.lottery.prizes[0].quantity = 0
  if (broken === 'duplicate-prize') value.draft.lottery.prizes.push({ ...value.draft.lottery.prizes[0] })
  if (broken === 'disabled-source') value.draft.program.entries[0].enabled = false
  const snapshot = createWizardSnapshot(value.draft, value.media, 3), before = JSON.stringify(snapshot)
  let calls = 0
  try { assert.equal(await saveWizardLottery(value.controller, snapshot, { transport: async () => { calls++; return json({}) } }), 'FAILED') }
  catch (error) { assert.match((error as Error).message, /V2 快照/) }
  assert.equal(calls, 0); assert.equal(JSON.stringify(snapshot), before); assert.equal(value.controller.getState().activityId, id)
})
test('program not saved, ID missing or receipt mismatch forbids lottery before any request', async () => {
  const value = await fixture(false)
  assert.equal(await saveWizardLottery(value.controller, value.snapshot), 'BLOCKED')
  const ready = await fixture(), checkpoint = ready.controller.getCheckpoint()
  for (const altered of [{ ...checkpoint, activityId: null }, { ...checkpoint, activityId: 'foreign-activity' }, { ...checkpoint, confirmedProgram: null }, { ...checkpoint, confirmedProgram: { ...checkpoint.confirmedProgram!, snapshotId: 'foreign-snapshot' } }]) {
    let calls = 0
    assert.equal(await saveWizardLottery(WizardSaveSessionController.restore(altered), ready.snapshot, { transport: async () => { calls++; return json({}) } }), 'BLOCKED')
    assert.equal(calls, 0)
  }
})
test('program PATCH acknowledged but GET unconfirmed is not a lottery prerequisite', async () => {
  const value = await fixture(), checkpoint = value.controller.getCheckpoint()
  checkpoint.programSave.readback = 'FAILED'
  assert.equal(await saveWizardLottery(WizardSaveSessionController.restore(checkpoint), value.snapshot), 'BLOCKED')
})
test('double click during preflight/PATCH is locked; all later actions are GET only', async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  let release!: () => void, started!: () => void
  const pause = new Promise<void>((resolve) => { release = resolve }), startedPromise = new Promise<void>((resolve) => { started = resolve })
  const slow = async (path: string, init: RequestInit) => { if (init.method === 'PATCH') { started(); await pause } return ok(path, init) }
  const first = saveWizardLottery(value.controller, value.snapshot, { transport: slow })
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: slow }), 'BLOCKED')
  await startedPromise
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: slow }), 'BLOCKED')
  release(); assert.equal(await first, 'CONFIRMED')
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: ok }), 'CONFIRMED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
})
for (const blocker of ['foreign-activity', 'changed-program', 'locked', 'encryption', 'existing-config', 'participants', 'draw']) test(`preflight ${blocker} stops before PATCH`, async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  const result = await saveWizardLottery(value.controller, value.snapshot, { transport: async (path, init) => {
    if (blocker === 'foreign-activity' && !path.endsWith('/v2') && !path.endsWith('/lottery')) return json({ activity: { ...value.activity, id: 'other-activity' } })
    if (blocker === 'changed-program' && path.endsWith('/v2')) return json({ activity: value.activity, canReview: true, program: createDefaultTopicActivityV2Program() })
    if (path.endsWith('/lottery')) {
      const body = view()
      if (blocker === 'locked') body.configLocked = true
      if (blocker === 'encryption') body.addressEncryptionReady = false
      if (blocker === 'existing-config') body.config = { ...defaultTopicLotteryConfig(), title: 'other configuration' }
      if (blocker === 'participants') body.candidateCount = 1
      if (blocker === 'draw') return json({ ...body, draw: { id: 'draw-fixture' } })
      return json(body)
    }
    return ok(path, init)
  } })
  assert.equal(result, 'FAILED'); assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 0)
  assert.equal(value.controller.getState().lotterySave.error?.stage, 'PREFLIGHT')
})
test('existing identical config confirms without any PATCH', async () => {
  const value = await fixture(), calls: string[] = []
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: transportFor(value, calls, prepareWizardLotteryPayload(value.snapshot)!.config) }), 'CONFIRMED')
  assert.equal(calls.length, 3)
})
for (const failure of ['timeout', '500', 'malformed', '400', '429']) test(`lottery PATCH ${failure} is never repeated; outcome is preserved and GET-only recovery`, async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  let patches = 0
  const transport = async (path: string, init: RequestInit) => {
    if (init.method === 'PATCH') {
      patches++
      if (failure === 'timeout') return new Promise<Response>(() => {})
      if (failure === 'malformed') return json({ config: {} })
      return json({}, Number(failure))
    }
    return ok(path, init)
  }
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport, timeoutMs: 15 }), ['400', '429'].includes(failure) ? 'FAILED' : 'UNKNOWN')
  assert.equal(value.controller.getState().lotterySave.error?.stage, 'SAVE')
  const restored = WizardSaveSessionController.restore(value.controller.getCheckpoint())
  assert.equal(await saveWizardLottery(restored, value.snapshot, { transport }), 'FAILED')
  assert.equal(patches, 1)
  value.draft.lottery.enabled = false // Must not bypass a possible write by toggling the UI state.
  assert.equal(await saveWizardLottery(restored, createWizardSnapshot(value.draft, value.media, 3), { transport: transportFor(value, [], prepareWizardLotteryPayload(value.snapshot)!.config) }), 'CONFIRMED')
  assert.equal(patches, 1); assert.equal(restored.getState().activityId, id)
})
test('GET after PATCH mismatch preserves acknowledged save and only permits further GET', async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  let written = false
  const bad = async (path: string, init: RequestInit) => {
    if (init.method === 'PATCH') { written = true; return ok(path, init) }
    if (written && path.endsWith('/lottery')) return json(view())
    return ok(path, init)
  }
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: bad }), 'FAILED')
  assert.equal(value.controller.getState().stages.LOTTERY, 'SUCCEEDED')
  assert.equal(value.controller.getState().lotterySave.readback, 'FAILED')
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: bad }), 'FAILED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: ok }), 'CONFIRMED')
})
test('adapter uses config whitelist, stable IDs, activity deadline and strips injected UI/request data', async () => {
  const value = await fixture()
  Object.assign(value.draft.lottery, { activityId: 'other', draw: { run: true }, userId: 'private-user', requestLock: 'fake' })
  Object.assign(value.draft.lottery.prizes[0], { remaining: 99, file: 'local-file', winnerId: 'fake' })
  const payload = prepareWizardLotteryPayload(createWizardSnapshot(value.draft, value.media, 3))!
  assert.deepEqual(Object.keys(payload), ['config'])
  assert.equal(payload.config.eligibilityDeadline, prepareWizardActivityPayload(value.snapshot).endsAt)
  assert.equal(payload.config.prizes[0].id, value.draft.lottery.prizes[0].id)
  assert.doesNotMatch(JSON.stringify(payload), /requestLock|activityId|winnerId|remaining|local-file|private-user/)
})
test('unuploaded prize image blocks without network; existing uploaded public image can map through adapter', async () => {
  const value = await fixture(), prizeId = value.draft.lottery.prizes[0].id
  value.media.prizes[prizeId] = selectWizardImage(new File(['fixture'], 'prize.png', { type: 'image/png' }))
  let calls = 0
  assert.equal(await saveWizardLottery(value.controller, createWizardSnapshot(value.draft, value.media, 3), { transport: async () => { calls++; return json({}) } }), 'FAILED')
  assert.equal(calls, 0)
  const pending = beginWizardImageUpload(value.media.prizes[prizeId])
  value.media.prizes[prizeId] = settleWizardImageUpload(pending, pending.selectionId!, pending.uploadRequestId!, { url: 'https://media.ecfc.fans/media/activities/prize-fixture/source.webp' })
  assert.equal(prepareWizardLotteryPayload(createWizardSnapshot(value.draft, value.media, 3))!.config.prizes[0].imageUrl, '/cos/activities/prize-fixture/source.webp')
})
test('lottery readback compares IDs, source/pool/time values; object key order is immaterial', async () => {
  const value = await fixture(), config = prepareWizardLotteryPayload(value.snapshot)!.config
  assert.equal(wizardLotteriesMatch(Object.fromEntries(Object.entries(config).reverse()), config), true)
  assert.equal(wizardLotteriesMatch({ ...config, prizes: [{ ...config.prizes[0], quantity: 7 }] }, config), false)
  assert.equal(wizardLotteriesMatch({ ...config, sourceEntryIds: ['foreign-source'] }, config), false)
  assert.equal(wizardLotteriesMatch(null, config), false)
})
test('interrupted PATCH keeps unknown outcome; late success cannot confirm or authorize another write', async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  let release!: (response: Response) => void, started!: () => void
  const startedPromise = new Promise<void>((resolve) => { started = resolve })
  const first = saveWizardLottery(value.controller, value.snapshot, { transport: async (path, init) => {
    if (init.method === 'PATCH') { started(); return new Promise<Response>((resolve) => { release = resolve }) }
    return ok(path, init)
  } })
  await startedPromise
  value.controller.finish(value.controller.getState().requestLock!)
  release(json({ config: prepareWizardLotteryPayload(value.snapshot)!.config }))
  assert.equal(await first, 'BLOCKED')
  assert.equal(value.controller.getState().stages.LOTTERY, 'UNKNOWN')
  assert.equal(value.controller.getState().activityId, id)
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: transportFor(value, [], prepareWizardLotteryPayload(value.snapshot)!.config) }), 'CONFIRMED')
})
test('AUTO mode is configuration only and never invokes a draw or reward endpoint', async () => {
  const value = await fixture(), calls: string[] = []
  value.draft.lottery.mode = 'AUTO'
  const snapshot = createWizardSnapshot(value.draft, value.media, 3)
  assert.equal(await saveWizardLottery(value.controller, snapshot, { transport: transportFor(value, calls) }), 'CONFIRMED')
  assert.equal(value.controller.getState().lotterySave.snapshot?.draft.lottery.mode, 'AUTO')
  assert.ok(calls.every((call) => !/\/draw|\/reward|\/winners|\/shipment|\/address/.test(call)))
})
test('lottery transport never calls draw/winner/shipping/address/reward/publication endpoints', () => {
  const source = readFileSync('components/activities/TopicActivityWizardLotterySave.ts', 'utf8')
  assert.equal((source.match(/method: 'PATCH'/g) || []).length, 1)
  assert.doesNotMatch(source, /method: '(POST|DELETE|PUT)'|\/draw|\/winners|\/shipment|\/address|\/reward|status: 'PUBLISHED'|uploadActivityImage/)
})
