import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createWizardId, createWizardOption } from '../components/activities/TopicActivityWizardIds'
import { createTopicWizardDraft, toggleTopicWizardPlatform, changeTopicWizardEnd } from '../components/activities/TopicActivityWizardState'
import { beginWizardImageUpload, createWizardMedia, selectWizardImage, settleWizardImageUpload } from '../components/activities/TopicActivityWizardMedia'
import { createWizardSnapshot, restoreWizardSnapshot, WizardSaveSessionController, wizardSaveStages } from '../components/activities/TopicActivityWizardSession'
import { prepareWizardPayloads, requireReadyWizardPayloads } from '../components/activities/TopicActivityWizardPayload'
import { normalizeActivityInput } from '../lib/activity-validation'
import { normalizeTopicActivityConfig } from '../lib/topic-activity-config'
import { normalizeTopicActivityV2Program } from '../lib/topic-activity-v2-config'
import { normalizeTopicLotteryConfig } from '../lib/topic-activity-v2-lottery-config'

function validDraft() {
  let draft = toggleTopicWizardPlatform(createTopicWizardDraft(), 'weibo')
  draft.activity.title = '测试活动'; draft.activity.description = '活动介绍'; draft.activity.participationRule = '提交截图，审核通过'
  draft.activity.startsAt = '2030-10-01T09:00'
  draft = changeTopicWizardEnd(draft, '2030-10-10T18:00')
  draft.lottery.enabled = true; draft.lottery.drawAt = '2030-10-11T18:00'; draft.lottery.addressDeadline = '2030-10-18T18:00'
  draft.lottery.prizes = [{ id: createWizardId('prize'), name: '礼物', description: '', imageUrl: null, quantity: 3, sortOrder: 0 }]
  return draft
}
function validSnapshot() { return createWizardSnapshot(validDraft(), createWizardMedia(), 3) }
function file(name = 'fixture.png') { return new File(['fixture-only'], name, { type: 'image/png' }) }
function uploaded(url: string) {
  const pending = beginWizardImageUpload(selectWizardImage(file()))
  return settleWizardImageUpload(pending, pending.selectionId!, pending.uploadRequestId!, { url })
}

test('1000 task/prize/option IDs are unique, secure UUID based and satisfy contract length', () => {
  const ids = Array.from({ length: 1000 }, (_, index) => createWizardId((['task', 'prize', 'option'] as const)[index % 3]))
  assert.equal(new Set(ids).size, ids.length)
  ids.forEach((id) => assert.match(id, /^[a-z]+-[a-f0-9-]{36}$/))
  assert.ok(ids.every((id) => id.length <= 64))
})
test('separate wizard drafts cannot reuse task, poll, test or prize identities', () => {
  const first = validDraft(), second = validDraft()
  assert.notEqual(first.identity.draftId, second.identity.draftId)
  assert.notEqual(first.program.entries[0].id, second.program.entries[0].id)
  assert.notEqual(first.program.poll.id, second.program.poll.id)
  assert.notEqual(first.program.test.id, second.program.test.id)
  assert.notEqual(first.lottery.prizes[0].id, second.lottery.prizes[0].id)
})
test('option IDs remain unchanged through snapshot restore and repeated adapter conversion', () => {
  const draft = validDraft()
  draft.program.poll.options = [createWizardOption('甲'), createWizardOption('乙')]
  const snapshot = createWizardSnapshot(draft, createWizardMedia(), 3)
  const first = requireReadyWizardPayloads(prepareWizardPayloads(snapshot))
  const second = requireReadyWizardPayloads(prepareWizardPayloads(snapshot))
  assert.deepEqual(first, second)
  assert.deepEqual(first.program.program.poll.options, draft.program.poll.options)
  assert.deepEqual(restoreWizardSnapshot(snapshot).draft.identity, draft.identity)
})
test('snapshot is an immutable copy, not a reference to live UI state', () => {
  const draft = validDraft(), snapshot = createWizardSnapshot(draft, createWizardMedia(), 2)
  draft.activity.title = 'changed after capture'
  assert.equal(snapshot.draft.activity.title, '测试活动')
  assert.ok(Object.isFrozen(snapshot.draft.program.entries))
  assert.throws(() => snapshot.draft.program.entries.push(snapshot.draft.program.entries[0]))
  const restored = restoreWizardSnapshot(snapshot)
  restored.draft.activity.title = 'changed restored copy'
  assert.equal(snapshot.draft.activity.title, '测试活动')
})
test('selected files never enter snapshot; JSON round trip requires re-selection and preserves IDs', () => {
  const draft = validDraft(), media = createWizardMedia()
  media.cover = selectWizardImage(file())
  const snapshot = createWizardSnapshot(draft, media, 1)
  assert.equal('file' in snapshot.media.cover, false)
  assert.equal(snapshot.media.cover.status, 'NEEDS_RESELECT')
  const restored = restoreWizardSnapshot(JSON.parse(JSON.stringify(snapshot)))
  assert.equal(restored.media.cover.file, null)
  assert.equal(restored.media.cover.status, 'NEEDS_RESELECT')
  assert.deepEqual(restored.draft.program.entries, draft.program.entries)
})
test('image state captures file -> pending upload -> URL; stale replacement receipts ignored', () => {
  const selected = selectWizardImage(file())
  const pending = beginWizardImageUpload(selected)
  assert.equal(pending.status, 'UPLOADING')
  const replacement = selectWizardImage(file('replacement.png'))
  assert.equal(settleWizardImageUpload(replacement, pending.selectionId!, pending.uploadRequestId!, { url: '/uploads/gift.png' }), replacement)
  const ready = settleWizardImageUpload(pending, pending.selectionId!, pending.uploadRequestId!, { url: '/uploads/gift.png' })
  assert.equal(ready.status, 'UPLOADED'); assert.equal(ready.url, '/uploads/gift.png')
})
test('image failures clear URL and retry gets a fresh request ID while keeping selection identity', () => {
  const pending = beginWizardImageUpload(selectWizardImage(file()))
  const failed = settleWizardImageUpload(pending, pending.selectionId!, pending.uploadRequestId!, { error: 'fixture failure' })
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.url, null)
  const retry = beginWizardImageUpload(failed)
  assert.equal(retry.selectionId, pending.selectionId); assert.notEqual(retry.uploadRequestId, pending.uploadRequestId)
  assert.equal(settleWizardImageUpload(retry, pending.selectionId!, pending.uploadRequestId!, { url: '/uploads/late.png' }), retry)
})
test('preview/blob upload receipts are not accepted as ready image state', () => {
  const pending = beginWizardImageUpload(selectWizardImage(file()))
  assert.equal(settleWizardImageUpload(pending, pending.selectionId!, pending.uploadRequestId!, { url: 'blob:local' }).status, 'FAILED')
})
test('synchronous request lock blocks double-click even before a React rerender', () => {
  const snapshot = validSnapshot(), controller = new WizardSaveSessionController(snapshot.draftId)
  const first = controller.begin(snapshot, 'PUBLISHED')
  assert.ok(first)
  assert.equal(controller.begin(snapshot, 'PUBLISHED'), null)
  assert.equal(controller.getState().requestLock?.id, first.id)
})
test('failed stage prevents later stages; lock is released without discarding prior server result', () => {
  const snapshot = validSnapshot(), controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  const token = controller.begin(snapshot, 'PUBLISHED')!
  controller.startStage(token, 'UPLOAD'); controller.completeStage(token, 'UPLOAD', 'SKIPPED')
  controller.startStage(token, 'ACTIVITY'); controller.completeStage(token, 'ACTIVITY', 'SUCCEEDED', 'activity-fixture')
  controller.startStage(token, 'PROGRAM'); controller.failStage(token, 'PROGRAM', 'fixture rejection')
  assert.throws(() => controller.startStage(token, 'LOTTERY'))
  controller.finish(token)
  assert.equal(controller.getState().requestLock, null)
  assert.equal(controller.getState().activityId, 'activity-fixture')
  assert.equal(controller.getState().stages.ACTIVITY, 'SUCCEEDED')
  const retry = controller.begin(snapshot, 'PUBLISHED')!
  assert.ok(retry)
  assert.throws(() => controller.startStage(retry, 'ACTIVITY'))
  assert.ok(controller.startStage(retry, 'PROGRAM'))
  assert.throws(() => controller.completeStage(retry, 'PROGRAM', 'SUCCEEDED', 'another-activity'))
})
test('partial saved snapshot is pinned: new inputs or another draft cannot overwrite it', () => {
  const snapshot = validSnapshot(), controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  const token = controller.begin(snapshot, 'PUBLISHED')!
  controller.startStage(token, 'UPLOAD'); controller.completeStage(token, 'UPLOAD', 'SKIPPED')
  controller.startStage(token, 'ACTIVITY'); controller.completeStage(token, 'ACTIVITY', 'SUCCEEDED', 'activity-fixture')
  controller.finish(token)
  assert.throws(() => controller.begin(validSnapshot(), 'PUBLISHED'))
  assert.throws(() => controller.begin(createWizardSnapshot(snapshot.draft, createWizardMedia(), 3), 'PUBLISHED'))
})
test('unknown create outcome blocks retry; restored pending requests become UNKNOWN, not fresh creates', () => {
  const snapshot = validSnapshot(), controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  const token = controller.begin(snapshot, 'PUBLISHED')!
  controller.startStage(token, 'UPLOAD'); controller.completeStage(token, 'UPLOAD', 'SKIPPED')
  controller.startStage(token, 'ACTIVITY')
  const restored = WizardSaveSessionController.restore(controller.getCheckpoint())
  assert.equal(restored.getState().requestLock, null)
  assert.equal(restored.getState().stages.ACTIVITY, 'UNKNOWN')
  assert.equal(restored.begin(snapshot, 'PUBLISHED'), null)
  controller.failStage(token, 'ACTIVITY', 'result unknown', 'UNKNOWN'); controller.finish(token)
  assert.equal(controller.begin(snapshot, 'PUBLISHED'), null)
})
test('checkpoint restore keeps saved activity identity but requires fresh server readback', () => {
  const snapshot = validSnapshot(), controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  const token = controller.begin(snapshot, 'PUBLISHED')!
  controller.startStage(token, 'UPLOAD'); controller.completeStage(token, 'UPLOAD', 'SKIPPED')
  controller.startStage(token, 'ACTIVITY'); controller.completeStage(token, 'ACTIVITY', 'SUCCEEDED', 'activity-fixture')
  controller.finish(token)
  const restored = WizardSaveSessionController.restore(JSON.parse(JSON.stringify(controller.getCheckpoint())))
  assert.equal(restored.getState().activityId, 'activity-fixture')
  assert.equal(restored.getState().needsReadback, true)
  assert.equal(restored.begin(snapshot, 'PUBLISHED'), null)
})
test('simulation never fabricates saved activity identity or server success', () => {
  const snapshot = validSnapshot(), controller = new WizardSaveSessionController(snapshot.draftId)
  const token = controller.begin(snapshot, 'PUBLISHED')!
  controller.startStage(token, 'UPLOAD'); controller.completeStage(token, 'UPLOAD', 'SKIPPED')
  controller.startStage(token, 'ACTIVITY')
  assert.throws(() => controller.completeStage(token, 'ACTIVITY', 'SUCCEEDED', 'fake-activity'))
  controller.completeStage(token, 'ACTIVITY', 'SIMULATED')
  assert.equal(controller.getState().activityId, null)
})
test('late callbacks cannot unlock or mutate a newer attempt', () => {
  const snapshot = validSnapshot(), controller = new WizardSaveSessionController(snapshot.draftId)
  const first = controller.begin(snapshot, 'DRAFT')!; controller.finish(first)
  const second = controller.begin(snapshot, 'DRAFT')!
  assert.equal(controller.startStage(first, 'UPLOAD'), false)
  assert.equal(controller.finish(first), false)
  assert.equal(controller.getState().requestLock?.id, second.id)
})
test('API publish requires a real readback, not skipped or simulated verification', () => {
  const snapshot = validSnapshot(), controller = new WizardSaveSessionController(snapshot.draftId, 'API')
  const token = controller.begin(snapshot, 'PUBLISHED')!
  for (const stage of wizardSaveStages.slice(0, 5)) {
    controller.startStage(token, stage)
    controller.completeStage(token, stage, stage === 'UPLOAD' || stage === 'READBACK' ? 'SKIPPED' : 'SUCCEEDED', stage === 'ACTIVITY' ? 'activity-fixture' : undefined)
  }
  assert.throws(() => controller.startStage(token, 'PUBLISH'))
})
test('adapter payloads satisfy unchanged Activity/V2/Lottery validators and explicit comment policy', () => {
  const payloads = requireReadyWizardPayloads(prepareWizardPayloads(validSnapshot()))
  assert.equal(normalizeActivityInput(payloads.activity).valid, true)
  const topic = normalizeTopicActivityConfig(payloads.activity, 'TOPIC_ACTIVITY')
  assert.equal(topic.valid, true)
  if (topic.valid) assert.equal(topic.value.formSchema.commentPolicy?.commentLimit, 'MULTIPLE')
  assert.equal(normalizeTopicActivityV2Program(payloads.program.program).valid, true)
  assert.ok(payloads.lottery)
  assert.deepEqual(normalizeTopicLotteryConfig(payloads.lottery.config), payloads.lottery.config)
  assert.equal(payloads.activity.status, 'DRAFT')
  assert.equal(payloads.activity.startsAt, '2030-10-01T01:00:00.000Z')
  assert.equal(payloads.lottery.config.eligibilityDeadline, payloads.activity.endsAt)
  assert.equal('identity' in payloads.activity, false)
  assert.equal('requestLock' in payloads.program, false)
})
test('local cover stays preview-only, remains optional and never leaks File or blob values', () => {
  const draft = validDraft(), media = createWizardMedia()
  media.cover = selectWizardImage(file())
  const prepared = prepareWizardPayloads(createWizardSnapshot(draft, media, 3))
  assert.equal(prepared.kind, 'READY')
  if (prepared.kind !== 'READY') return
  assert.equal(prepared.payloads.activity.coverUrl, null)
  assert.doesNotMatch(JSON.stringify(prepared.payloads), /selectionId|fileInfo|uploadRequestId|blob:|data:/)
  assert.doesNotMatch(JSON.stringify(prepared), /selectionId|fileInfo|uploadRequestId|blob:/)
})
test('adapter maps existing uploader media URL to each target image contract', () => {
  const draft = validDraft(), media = createWizardMedia()
  media.cover = uploaded('https://media.ecfc.fans/media/activities/cover-fixture/source.webp')
  media.prizes[draft.lottery.prizes[0].id] = uploaded('https://media.ecfc.fans/media/activities/prize-fixture/source.webp')
  const restored = restoreWizardSnapshot(createWizardSnapshot(draft, media, 3))
  assert.equal(restored.media.cover.status, 'UPLOADED')
  const payloads = requireReadyWizardPayloads(prepareWizardPayloads(createWizardSnapshot(restored.draft, restored.media, 3)))
  assert.ok(payloads.activity.coverUrl?.endsWith('/activities/cover-fixture/source.webp'))
  assert.equal(normalizeActivityInput(payloads.activity).valid, true)
  assert.equal(payloads.lottery?.config.prizes[0].imageUrl, '/cos/activities/prize-fixture/source.webp')
})
test('adapter fails closed for signed, arbitrary, private and blob image locations', () => {
  for (const url of ['https://invalid.example/prize.png', '/api/private/image.png', '/uploads/a.png?signature=fixture', 'blob:preview']) {
    const draft = validDraft(), media = createWizardMedia()
    media.prizes[draft.lottery.prizes[0].id] = uploaded(url)
    assert.equal(prepareWizardPayloads(createWizardSnapshot(draft, media, 3)).kind, 'BLOCKED')
  }
})
test('disabled lottery produces no lottery write payload and adapter does not mutate UI state', () => {
  const draft = validDraft(); draft.lottery.enabled = false
  const snapshot = createWizardSnapshot(draft, createWizardMedia(), 3), before = JSON.stringify(snapshot)
  const payloads = requireReadyWizardPayloads(prepareWizardPayloads(snapshot))
  assert.equal(payloads.lottery, null)
  payloads.program.program.entries[0].points = 99
  assert.equal(JSON.stringify(snapshot), before)
})
test('Phase 1.5 safety modules have no API transport or automatic browser persistence', () => {
  for (const name of ['Ids', 'Media', 'Session', 'Payload']) {
    const source = readFileSync(`components/activities/TopicActivityWizard${name}.ts`, 'utf8')
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|axios|uploadActivityImage\(/)
  }
})
