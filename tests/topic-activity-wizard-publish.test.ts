import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createDefaultTopicActivityV2Program } from '../lib/topic-activity-v2-config'
import { defaultTopicLotteryConfig } from '../lib/topic-activity-v2-lottery-config'
import { createTopicWizardDraft, toggleTopicWizardPlatform } from '../components/activities/TopicActivityWizardState'
import { createWizardId } from '../components/activities/TopicActivityWizardIds'
import { createWizardMedia, selectWizardImage } from '../components/activities/TopicActivityWizardMedia'
import { createWizardSnapshot, WizardSaveSessionController } from '../components/activities/TopicActivityWizardSession'
import { prepareWizardActivityPayload, prepareWizardProgramPayload, prepareWizardLotteryPayload } from '../components/activities/TopicActivityWizardPayload'
import { saveWizardActivityDraft } from '../components/activities/TopicActivityWizardActivitySave'
import { saveWizardProgram } from '../components/activities/TopicActivityWizardProgramSave'
import { saveWizardLottery } from '../components/activities/TopicActivityWizardLotterySave'
import { publishWizardActivity } from '../components/activities/TopicActivityWizardPublish'

const id = 'wizard-publish-activity'
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
async function fixture(lottery = false, saveLottery = true, localCover = false) {
  const draft = toggleTopicWizardPlatform(createTopicWizardDraft(), 'weibo'), media = createWizardMedia()
  if (localCover) media.cover = selectWizardImage(new File(['local-only'], 'cover.png', { type: 'image/png' }))
  Object.assign(draft.activity, { title: '发布测试', description: '活动介绍', participationRule: '提交截图并审核', startsAt: '2030-10-01T09:00', endsAt: '2030-10-10T18:00' })
  if (lottery) Object.assign(draft.lottery, { enabled: true, drawAt: '2030-10-11T18:00', addressDeadline: '2030-10-18T18:00', prizes: [{ id: createWizardId('prize'), name: '礼物', description: '', imageUrl: null, quantity: 3, sortOrder: 0 }] })
  const snapshot = createWizardSnapshot(draft, media, 3), controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  const activity = { ...prepareWizardActivityPayload(snapshot), id }
  let program = createDefaultTopicActivityV2Program(), config = defaultTopicLotteryConfig()
  const transport = async (path: string, init: RequestInit) => {
    if (path.endsWith('/lottery')) {
      if (init.method === 'PATCH') { config = JSON.parse(init.body as string).config; return json({ config }) }
      return json(lotteryView(config))
    }
    if (path.endsWith('/v2')) {
      if (init.method === 'PATCH') { program = JSON.parse(init.body as string).program; return json({ program }) }
      return json({ activity, canReview: true, program })
    }
    return json({ activity }, init.method === 'POST' ? 201 : 200)
  }
  await saveWizardActivityDraft(controller, snapshot, { transport })
  await saveWizardProgram(controller, snapshot, { transport })
  if (lottery && saveLottery) await saveWizardLottery(controller, snapshot, { transport })
  return { draft, media, snapshot, controller, activity }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const lotteryView = (config: unknown) => ({ config, addressEncryptionReady: true, configLocked: false, candidateCount: 0, pendingSubmissionCount: 0, draw: null, winners: [], state: (config as { enabled?: boolean }).enabled ? 'NOT_STARTED' : 'DISABLED' })
function transportFor(value: Fixture, calls: string[], initiallyPublished = false) {
  let status = initiallyPublished ? 'PUBLISHED' : 'DRAFT'
  return async (path: string, init: RequestInit) => {
    calls.push(`${init.method} ${path}`)
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error')
    if (path.endsWith('/lottery')) return json(lotteryView(prepareWizardLotteryPayload(value.snapshot)?.config ?? defaultTopicLotteryConfig()))
    if (path.endsWith('/v2')) return json({ activity: { ...value.activity, status }, canReview: true, ...prepareWizardProgramPayload(value.snapshot) })
    if (init.method === 'PATCH') { assert.deepEqual(JSON.parse(init.body as string), { status: 'PUBLISHED' }); status = 'PUBLISHED' }
    return json({ activity: { ...value.activity, status } })
  }
}
for (const lottery of [false, true]) test(`publish succeeds with lottery ${lottery ? 'on + saved' : 'off'}, status-only PATCH + GET PUBLISHED`, async () => {
  const value = await fixture(lottery), calls: string[] = []
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: transportFor(value, calls) }), 'CONFIRMED')
  assert.deepEqual(calls, [`GET /api/admin/activities/${id}`, `GET /api/admin/activities/${id}/v2`, `GET /api/admin/activities/${id}/v2/lottery`, `PATCH /api/admin/activities/${id}`, `GET /api/admin/activities/${id}`])
  const state = value.controller.getState()
  assert.equal(state.stages.PUBLISH, 'SUCCEEDED'); assert.equal(state.publishSave.readback, 'SUCCEEDED'); assert.equal(state.confirmedPublish?.activityId, id)
  assert.equal(state.requestLock, null)
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: transportFor(value, calls) }), 'BLOCKED')
  assert.equal(await saveWizardActivityDraft(value.controller, value.snapshot, { transport: transportFor(value, calls) }), 'BLOCKED')
  assert.equal(await saveWizardProgram(value.controller, value.snapshot, { transport: transportFor(value, calls) }), 'BLOCKED')
  assert.equal(await saveWizardLottery(value.controller, value.snapshot, { transport: transportFor(value, calls) }), 'BLOCKED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
})
test('local cover preview does not block publish validation and is excluded from server payload', async () => {
  const value = await fixture(false, true, true), calls: string[] = []
  assert.equal(value.media.cover.status, 'SELECTED')
  assert.equal(value.activity.coverUrl, null)
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: transportFor(value, calls) }), 'CONFIRMED')
  assert.ok(calls.every((call) => !/cover\.png|blob:|upload/.test(call)))
  assert.equal(value.controller.getState().stages.PUBLISH, 'SUCCEEDED')
})
test('lottery on without saved/confirmed config blocks before any request', async () => {
  const value = await fixture(true, false)
  let calls = 0
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: async () => { calls++; return json({}) } }), 'BLOCKED')
  assert.equal(calls, 0)
})
test('missing/switching activity identity, missing V2 or lottery receipt blocks before any request', async () => {
  const value = await fixture(true), checkpoint = value.controller.getCheckpoint()
  for (const altered of [{ ...checkpoint, activityId: null }, { ...checkpoint, activityId: 'other-activity' }, { ...checkpoint, createdActivity: null }, { ...checkpoint, confirmedProgram: null }, { ...checkpoint, confirmedLottery: null }]) {
    let calls = 0
    assert.equal(await publishWizardActivity(WizardSaveSessionController.restore(altered), value.snapshot, { transport: async () => { calls++; return json({}) } }), 'BLOCKED')
    assert.equal(calls, 0)
  }
})
test('V2/lottery acknowledged PATCH without successful GET is insufficient to publish', async () => {
  const value = await fixture(true)
  for (const field of ['programSave', 'lotterySave'] as const) {
    const state = value.controller.getCheckpoint(); state[field].readback = 'FAILED'
    assert.equal(await publishWizardActivity(WizardSaveSessionController.restore(state), value.snapshot), 'BLOCKED')
  }
})
test('double clicks in preflight/PATCH/readback cannot publish twice', async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  let release!: () => void, started!: () => void
  const pause = new Promise<void>((resolve) => { release = resolve }), startedPromise = new Promise<void>((resolve) => { started = resolve })
  const slow = async (path: string, init: RequestInit) => { if (init.method === 'PATCH') { started(); await pause } return ok(path, init) }
  const first = publishWizardActivity(value.controller, value.snapshot, { transport: slow })
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: slow }), 'BLOCKED')
  await startedPromise
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: slow }), 'BLOCKED')
  release(); assert.equal(await first, 'CONFIRMED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
})
for (const blocker of ['activity', 'program', 'lottery', 'encryption', 'locked', 'empty-pool', 'source', 'expired']) test(`full publish gate blocks ${blocker} before PATCH`, async () => {
  const value = await fixture(true), calls: string[] = [], ok = transportFor(value, calls)
  const result = await publishWizardActivity(value.controller, value.snapshot, { now: blocker === 'expired' ? new Date('2031-01-01') : undefined, transport: async (path, init) => {
    if (blocker === 'activity' && !path.endsWith('/v2') && !path.endsWith('/lottery')) return json({ activity: { ...value.activity, title: 'changed' } })
    if (blocker === 'program' && path.endsWith('/v2')) return json({ activity: value.activity, canReview: true, program: createDefaultTopicActivityV2Program() })
    if (path.endsWith('/lottery')) {
      const config = prepareWizardLotteryPayload(value.snapshot)!.config
      if (blocker === 'lottery') return json(lotteryView(defaultTopicLotteryConfig()))
      if (blocker === 'encryption') return json({ ...lotteryView(config), addressEncryptionReady: false })
      if (blocker === 'locked') return json({ ...lotteryView(config), configLocked: true })
      if (blocker === 'empty-pool') return json(lotteryView({ ...config, prizes: [] }))
      if (blocker === 'source') return json(lotteryView({ ...config, sourceEntryIds: ['foreign-source'] }))
    }
    return ok(path, init)
  } })
  assert.equal(result, 'FAILED'); assert.equal(value.controller.getState().publishSave.error?.stage, 'PREFLIGHT')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 0)
})
test('UI lottery off cannot publish hidden enabled server lottery', async () => {
  const value = await fixture(), calls: string[] = [], enabled = await fixture(true), ok = transportFor(value, calls)
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: async (path, init) => path.endsWith('/lottery') ? json(lotteryView(prepareWizardLotteryPayload(enabled.snapshot)!.config)) : ok(path, init) }), 'FAILED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 0)
})
for (const failure of ['timeout', '500', 'malformed', '400', '403', '409']) test(`publish ${failure} preserves state, locks saves and only GETs on recovery`, async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  let patches = 0
  const transport = async (path: string, init: RequestInit) => {
    if (init.method === 'PATCH') { patches++; if (failure === 'timeout') return new Promise<Response>(() => {}); return json(failure === 'malformed' ? {} : { message: 'rejected' }, failure === 'malformed' ? 200 : Number(failure)) }
    return ok(path, init)
  }
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport, timeoutMs: 10 }), ['400', '403', '409'].includes(failure) ? 'FAILED' : 'UNKNOWN')
  assert.equal(value.controller.getState().activityId, id); assert.equal(value.controller.getState().stages.PROGRAM, 'SUCCEEDED')
  const restored = WizardSaveSessionController.restore(value.controller.getCheckpoint())
  assert.equal(await publishWizardActivity(restored, value.snapshot, { transport }), 'FAILED')
  assert.equal(patches, 1)
  assert.equal(await publishWizardActivity(restored, value.snapshot, { transport: transportFor(value, calls, true) }), 'CONFIRMED')
  assert.equal(patches, 1)
})
test('publish response success + GET failure keeps acknowledgement, then explicit GET recovers without PATCH', async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  let patched = false
  const transport = async (path: string, init: RequestInit) => { if (init.method === 'PATCH') { patched = true; return ok(path, init) } if (patched && !path.endsWith('/v2') && !path.endsWith('/lottery')) return json({}, 503); return ok(path, init) }
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport }), 'FAILED')
  assert.equal(value.controller.getState().stages.PUBLISH, 'SUCCEEDED'); assert.equal(value.controller.getState().publishSave.readback, 'FAILED')
  assert.equal(value.controller.getState().confirmedPublish, null)
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: ok }), 'CONFIRMED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
})
test('GET after publishing must be PUBLISHED, not an old DRAFT response', async () => {
  const value = await fixture(), calls: string[] = [], ok = transportFor(value, calls)
  let patched = false
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: async (path, init) => {
    if (init.method === 'PATCH') { patched = true; return ok(path, init) }
    if (patched && !path.endsWith('/v2') && !path.endsWith('/lottery')) return json({ activity: value.activity })
    return ok(path, init)
  } }), 'FAILED')
  assert.equal(value.controller.getState().confirmedPublish, null)
})
test('already published own activity confirms by GET without a second status PATCH', async () => {
  const value = await fixture(true), calls: string[] = []
  assert.equal(await publishWizardActivity(value.controller, value.snapshot, { transport: transportFor(value, calls, true) }), 'CONFIRMED')
  assert.ok(calls.every((call) => call.startsWith('GET')))
})
test('invalid/incomplete publication snapshot cannot change saved activity or lottery', async () => {
  const value = await fixture(true)
  const changed = structuredClone(value.snapshot); changed.draft.activity.description = ''
  await assert.rejects(publishWizardActivity(value.controller, changed), /发布快照不属于/)
  const pool = structuredClone(value.snapshot); pool.draft.lottery.prizes = []
  assert.equal(await publishWizardActivity(value.controller, pool), 'FAILED')
  assert.equal(value.controller.getState().publishSave.writeAttempted, false)
})
test('publication transport sends only one status PATCH, no config saves or draw/fulfillment', () => {
  const source = readFileSync('components/activities/TopicActivityWizardPublish.ts', 'utf8')
  assert.equal((source.match(/method: 'PATCH'/g) || []).length, 1)
  assert.doesNotMatch(source, /method: '(POST|DELETE|PUT)'|\/draw|\/winners|\/shipment|\/address|uploadActivityImage/)
  const manager = readFileSync('app/admin/activities/ActivityAdminManager.tsx', 'utf8')
  assert.match(manager, /onOpenEditor=\{openWizardEditor\}/)
  assert.match(manager, /setTopicWizardActivityId\(activityId\); setTopicWizardOpen\(true\)/)
  assert.match(manager, /高级设置/)
  assert.match(manager, /onClick=\{\(\) => void edit\(activity\)\}/)
})
