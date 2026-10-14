import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createDefaultTopicActivityV2Program } from '../lib/topic-activity-v2-config'
import { createTopicWizardDraft, toggleTopicWizardPlatform } from '../components/activities/TopicActivityWizardState'
import { createWizardMedia, selectWizardImage } from '../components/activities/TopicActivityWizardMedia'
import { createWizardSnapshot, WizardSaveSessionController } from '../components/activities/TopicActivityWizardSession'
import { prepareWizardActivityPayload, prepareWizardProgramPayload } from '../components/activities/TopicActivityWizardPayload'
import { saveWizardActivityDraft } from '../components/activities/TopicActivityWizardActivitySave'
import { saveWizardProgram, wizardProgramsMatch } from '../components/activities/TopicActivityWizardProgramSave'

const id = 'wizard-owned-activity'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
async function fixture() {
  const draft = toggleTopicWizardPlatform(createTopicWizardDraft(), 'weibo')
  Object.assign(draft.activity, { title: 'V2 草稿', description: '活动介绍', participationRule: '提交截图等待审核', startsAt: '2030-10-01T09:00', endsAt: '2030-10-10T18:00' })
  const snapshot = createWizardSnapshot(draft, createWizardMedia(), 3)
  const controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  await saveWizardActivityDraft(controller, snapshot, { transport: async (_, init) => json({ activity: { ...prepareWizardActivityPayload(snapshot), id } }, init.method === 'POST' ? 201 : 200) })
  return { draft, snapshot, controller }
}
function transportFor(snapshot: Awaited<ReturnType<typeof fixture>>['snapshot'], calls: string[], initial: unknown = createDefaultTopicActivityV2Program()) {
  let program: unknown = initial
  return async (path: string, init: RequestInit) => {
    calls.push(`${init.method} ${path}`)
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error')
    if (!path.endsWith('/v2')) return json({ activity: { ...prepareWizardActivityPayload(snapshot), id } })
    if (init.method === 'PATCH') { program = JSON.parse(init.body as string).program; return json({ program }) }
    return json({ activity: { id, status: 'DRAFT' }, canReview: true, program })
  }
}
test('V2 success uses acknowledged own activity ID, PATCH program-only then GET exact readback', async () => {
  const { snapshot, controller } = await fixture(), calls: string[] = []
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: transportFor(snapshot, calls) }), 'CONFIRMED')
  assert.deepEqual(calls, [`GET /api/admin/activities/${id}`, `GET /api/admin/activities/${id}/v2`, `PATCH /api/admin/activities/${id}/v2`, `GET /api/admin/activities/${id}/v2`])
  const state = controller.getState()
  assert.equal(state.activityId, id); assert.equal(state.stages.PROGRAM, 'SUCCEEDED'); assert.equal(state.programSave.readback, 'SUCCEEDED')
  assert.equal(state.stages.LOTTERY, 'SKIPPED'); assert.equal(state.stages.PUBLISH, 'IDLE'); assert.equal(state.requestLock, null)
})
test('missing activityId or unacknowledged creation forbids saving before any request', async () => {
  const { snapshot } = await fixture()
  for (const mode of ['API', 'SIMULATION'] as const) {
    const controller = new WizardSaveSessionController(snapshot.draftId, mode)
    let calls = 0
    assert.equal(await saveWizardProgram(controller, snapshot, { transport: async () => { calls++; return json({}) } }), 'BLOCKED')
    assert.equal(calls, 0)
  }
})
test('missing provenance, switched ID, switched draft and changed base activity cannot target another activity', async () => {
  const { snapshot, controller } = await fixture(), checkpoint = controller.getCheckpoint()
  for (const changed of [ { ...checkpoint, createdActivity: null }, { ...checkpoint, activityId: 'other-existing-activity' }, { ...checkpoint, draftId: 'foreign-draft' } ]) {
    let calls = 0
    const check = () => saveWizardProgram(WizardSaveSessionController.restore(changed), snapshot, { transport: async () => { calls++; return json({}) } })
    try { assert.equal(await check(), 'BLOCKED') } catch (error) { assert.match((error as Error).message, /不匹配|不属于/) }
    assert.equal(calls, 0)
  }
  const foreign = structuredClone(snapshot); foreign.draft.identity.draftId = foreign.draftId = 'foreign-draft'
  await assert.rejects(saveWizardProgram(controller, foreign), /不属于/)
  const changedBase = structuredClone(snapshot); changedBase.draft.activity.title = 'another activity'
  await assert.rejects(saveWizardProgram(controller, changedBase), /不属于/)
})
test('unverified activity readback blocks V2 save', async () => {
  const { snapshot, controller } = await fixture(), checkpoint = controller.getCheckpoint()
  checkpoint.stages.READBACK = 'FAILED'
  let calls = 0
  assert.equal(await saveWizardProgram(WizardSaveSessionController.restore(checkpoint), snapshot, { transport: async () => { calls++; return json({}) } }), 'BLOCKED')
  assert.equal(calls, 0)
})
test('double-click while preflight/PATCH pending sends only one PATCH; later clicks are GET only', async () => {
  const { snapshot, controller } = await fixture(), calls: string[] = [], transport = transportFor(snapshot, calls)
  let release!: () => void, started!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve }), patchStarted = new Promise<void>((resolve) => { started = resolve })
  const slow = async (path: string, init: RequestInit) => { if (init.method === 'PATCH') { started(); await pending } return transport(path, init) }
  const first = saveWizardProgram(controller, snapshot, { transport: slow })
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: slow }), 'BLOCKED')
  await patchStarted
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: slow }), 'BLOCKED')
  release(); assert.equal(await first, 'CONFIRMED')
  assert.equal(await saveWizardProgram(controller, snapshot, { transport }), 'CONFIRMED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
})
for (const status of [400, 401, 403, 409]) test(`V2 definite rejection ${status} retains inputs/ID and does not retry automatically`, async () => {
  const { snapshot, controller } = await fixture(), before = JSON.stringify(snapshot), calls: string[] = [], ok = transportFor(snapshot, calls)
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: async (path, init) => init.method === 'PATCH' ? json({ code: 'REJECTED' }, status) : ok(path, init) }), 'FAILED')
  assert.equal(controller.getState().activityId, id); assert.equal(controller.getState().programSave.error?.stage, 'SAVE')
  assert.equal(controller.getState().stages.PROGRAM, 'FAILED'); assert.equal(controller.getState().requestLock, null)
  assert.equal(JSON.stringify(snapshot), before)
})
test('existing divergent program, even disabled, stops before PATCH and preserves existing config', async () => {
  const { snapshot, controller } = await fixture(), calls: string[] = []
  const existing = createDefaultTopicActivityV2Program(); existing.materials = 'other admin settings'
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: transportFor(snapshot, calls, existing) }), 'FAILED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 0)
  assert.equal(existing.materials, 'other admin settings'); assert.equal(controller.getState().programSave.error?.stage, 'PREFLIGHT')
})
test('existing identical program confirms via GET without any PATCH', async () => {
  const { snapshot, controller } = await fixture(), calls: string[] = []
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: transportFor(snapshot, calls, prepareWizardProgramPayload(snapshot).program) }), 'CONFIRMED')
  assert.equal(calls.length, 2)
})
for (const phase of ['base', 'v2']) test(`preflight ${phase} foreign ID/published state fails before PATCH`, async () => {
  const { snapshot, controller } = await fixture(), calls: string[] = [], ok = transportFor(snapshot, calls)
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: async (path, init) => {
    if (phase === 'base' && !path.endsWith('/v2')) return json({ activity: { ...prepareWizardActivityPayload(snapshot), id: 'wrong-id' } })
    if (phase === 'v2' && path.endsWith('/v2')) return json({ activity: { id, status: 'PUBLISHED' }, program: null, canReview: true })
    return ok(path, init)
  } }), 'FAILED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 0)
})
test('GET after PATCH mismatch is a READBACK failure; recovery cannot overwrite divergent config', async () => {
  const { snapshot, controller } = await fixture(), calls: string[] = [], ok = transportFor(snapshot, calls)
  let written = false
  const transport = async (path: string, init: RequestInit) => {
    if (init.method === 'PATCH') { written = true; return ok(path, init) }
    if (written && path.endsWith('/v2')) return json({ activity: { id, status: 'DRAFT' }, canReview: true, program: createDefaultTopicActivityV2Program() })
    return ok(path, init)
  }
  assert.equal(await saveWizardProgram(controller, snapshot, { transport }), 'FAILED')
  assert.equal(controller.getState().stages.PROGRAM, 'SUCCEEDED'); assert.equal(controller.getState().programSave.readback, 'FAILED')
  assert.equal(controller.getState().programSave.error?.stage, 'READBACK'); assert.equal(controller.getState().activityId, id)
  assert.equal(await saveWizardProgram(controller, snapshot, { transport }), 'FAILED')
  assert.equal(calls.filter((call) => call.startsWith('PATCH')).length, 1)
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: ok }), 'CONFIRMED')
})
for (const failure of ['timeout', '500', 'malformed-response']) test(`unknown V2 ${failure} locks snapshot and retries GET only`, async () => {
  const { snapshot, controller } = await fixture(), calls: string[] = [], ok = transportFor(snapshot, calls)
  let patches = 0
  const transport = async (path: string, init: RequestInit) => {
    if (init.method === 'PATCH') {
      patches++
      if (failure === 'timeout') return new Promise<Response>(() => {})
      return json(failure === '500' ? {} : { program: {} }, failure === '500' ? 500 : 200)
    }
    return ok(path, init)
  }
  assert.equal(await saveWizardProgram(controller, snapshot, { transport, timeoutMs: 10 }), 'UNKNOWN')
  assert.equal(controller.getState().stages.PROGRAM, 'UNKNOWN')
  const restored = WizardSaveSessionController.restore(controller.getCheckpoint())
  assert.equal(await saveWizardProgram(restored, snapshot, { transport }), 'FAILED')
  assert.equal(patches, 1)
  const expected = transportFor(snapshot, [], prepareWizardProgramPayload(snapshot).program)
  assert.equal(await saveWizardProgram(restored, snapshot, { transport: expected }), 'CONFIRMED')
})
test('V2 adapter ignores lottery/image/session extras and normalizes only program whitelist', async () => {
  const { draft } = await fixture(), media = createWizardMedia()
  draft.lottery.enabled = true; draft.lottery.prizes = [] // Incomplete lottery has no bearing on V2.
  Object.assign(draft.program, { activityId: 'foreign', lottery: draft.lottery, requestLock: 'injected' })
  media.prizes.pending = selectWizardImage(new File(['fixture'], 'prize.png', { type: 'image/png' }))
  const payload = prepareWizardProgramPayload(createWizardSnapshot(draft, media, 3))
  assert.deepEqual(Object.keys(payload), ['program'])
  for (const key of ['activityId', 'lottery', 'requestLock', 'file', 'config']) assert.equal(key in payload.program, false)
})
test('program readback compares meaningful fields, ignores object key order but preserves array order and IDs', async () => {
  const { snapshot } = await fixture(), program = prepareWizardProgramPayload(snapshot).program
  assert.equal(wizardProgramsMatch(Object.fromEntries(Object.entries(program).reverse()), program), true)
  assert.equal(wizardProgramsMatch({ ...program, entries: [{ ...program.entries[0], points: 7 }] }, program), false)
  assert.equal(wizardProgramsMatch(null, program), false)
})
test('invalid program and preflight network failure preserve ID, never PATCH and release the request lock', async () => {
  const { draft, snapshot, controller } = await fixture()
  draft.program.entries[0].points = -1
  let calls = 0
  assert.equal(await saveWizardProgram(controller, createWizardSnapshot(draft, createWizardMedia(), 3), { transport: async () => { calls++; return json({}) } }), 'FAILED')
  assert.equal(calls, 0); assert.equal(controller.getState().activityId, id); assert.equal(controller.getState().requestLock, null)
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: async () => { calls++; throw new Error('offline') } }), 'FAILED')
  assert.equal(calls, 1); assert.equal(controller.getState().programSave.error?.stage, 'PREFLIGHT')
})
test('known rejected save can be explicitly retried using edited program, without recreating activity', async () => {
  const { draft, snapshot, controller } = await fixture(), calls: string[] = [], ok = transportFor(snapshot, calls)
  assert.equal(await saveWizardProgram(controller, snapshot, { transport: async (path, init) => init.method === 'PATCH' ? json({}, 400) : ok(path, init) }), 'FAILED')
  draft.program.entries[0].points = 5
  const edited = createWizardSnapshot(draft, createWizardMedia(), 3)
  assert.equal(await saveWizardProgram(controller, edited, { transport: transportFor(snapshot, calls) }), 'CONFIRMED')
  assert.equal(controller.getState().programSave.snapshot?.draft.program.entries[0].points, 5)
  assert.ok(calls.every((call) => !call.startsWith('POST')))
})
test('interrupted PATCH remains unknown; late response cannot confirm or overwrite the session', async () => {
  const { snapshot, controller } = await fixture(), calls: string[] = [], ok = transportFor(snapshot, calls)
  let release!: (response: Response) => void, started!: () => void
  const startedPromise = new Promise<void>((resolve) => { started = resolve })
  const first = saveWizardProgram(controller, snapshot, { transport: async (path, init) => {
    if (init.method === 'PATCH') { started(); return new Promise<Response>((resolve) => { release = resolve }) }
    return ok(path, init)
  } })
  await startedPromise
  controller.finish(controller.getState().requestLock!)
  release(json({ program: prepareWizardProgramPayload(snapshot).program }))
  assert.equal(await first, 'BLOCKED')
  assert.equal(controller.getState().stages.PROGRAM, 'UNKNOWN')
  assert.equal(controller.getState().activityId, id)
})
test('phase 2-B has only PATCH program transport, no lottery/upload/publish/draw endpoints', () => {
  const source = readFileSync('components/activities/TopicActivityWizardProgramSave.ts', 'utf8')
  assert.equal((source.match(/method: 'PATCH'/g) || []).length, 1)
  assert.doesNotMatch(source, /method: '(POST|DELETE|PUT)'|\/lottery|\/draw|uploadActivityImage|status: 'PUBLISHED'/)
})
