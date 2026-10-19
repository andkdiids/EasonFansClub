import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTopicLotteryConfigUpdateAllowed, assertTopicLotterySourceProgramRulesUnchanged, defaultTopicLotteryConfig, normalizeTopicLotteryConfig, normalizeTopicLotteryConfigForRead, normalizeTopicLotteryPrizeImageReference, resolveTopicLotteryPrizeImageSrc, topicLotterySourceRulesLocked } from '@/lib/topic-activity-v2-lottery-config'
import { createDefaultTopicActivityV2Program, type TopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { getMediaPublicBaseUrl } from '@/lib/media-url'
import { sampleTopicLotteryUsers } from '@/lib/topic-activity-v2-lottery-random'

const valid = () => ({ ...defaultTopicLotteryConfig(), enabled: true, sourceEntryIds: ['platform-one'], drawAt: '2026-10-20T12:00:00+08:00',
  eligibilityDeadline: '2026-10-20T11:00:00+08:00', addressDeadline: '2026-10-27T12:00:00+08:00', prizes: [{ id: 'gift-one', name: '测试奖品', description: '', imageUrl: '/images/gift.png', quantity: 2, sortOrder: 0 }] })
test('old activities default to disabled lottery with zero costs', () => {
  assert.equal(normalizeTopicLotteryConfig({}).enabled, false)
  assert.deepEqual(normalizeTopicLotteryConfig({}).prizes, [])
})
test('Shanghai date input normalized; deadline cannot follow draw or precede address deadline', () => {
  assert.equal(normalizeTopicLotteryConfig(valid()).drawAt, '2026-10-20T04:00:00.000Z')
  assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), eligibilityDeadline: '2026-10-21' }), { code: 'LOTTERY_CONFIG_INVALID' })
  assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), addressDeadline: '2026-10-19' }), { code: 'LOTTERY_CONFIG_INVALID' })
})
test('enabled configuration requires stable eligible source IDs, prizes and all deadlines', () => {
  for (const changed of [{ sourceEntryIds: [] }, { prizes: [] }, { drawAt: null }, { eligibilityDeadline: null }, { addressDeadline: null }])
    assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), ...changed }), { code: 'LOTTERY_CONFIG_INVALID' })
  assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), sourceEntryIds: ['platform-one', 'platform-one'] }), { code: 'LOTTERY_CONFIG_INVALID' })
})
test('quantities are positive integers and total stock bounded; no paid or weighted option', () => {
  for (const quantity of [0, -1, 1.5, 1001]) assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), prizes: [{ ...valid().prizes[0], quantity }] }), { code: 'LOTTERY_CONFIG_INVALID' })
  const value = normalizeTopicLotteryConfig({ ...valid(), pointsCost: 96, extraTickets: 5, weight: 4 })
  assert.equal('pointsCost' in value, false); assert.equal('extraTickets' in value, false); assert.equal('weight' in value, false)
})
test('private originals, signed URLs and arbitrary remote images are not public prize images', () => {
  for (const imageUrl of ['/cos/topic-activity/private/original-photo.png', 'https://hostile.invalid/a.png', 'https://media.ecfc.fans/media/activities/asset-one/source.webp?signature=secret', '/images/a.png?secret=value', '/images/%2e%2e/private.png', 'blob:https://ecfc.fans/temporary-id'])
    assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), prizes: [{ ...valid().prizes[0], imageUrl }] }), { code: 'LOTTERY_CONFIG_INVALID' })
})
test('official activity-image upload response normalizes to a stable COS object reference and resolves publicly', () => {
  const uploadedUrl = `${getMediaPublicBaseUrl()}/activities/asset-one/source.webp`
  const reference = normalizeTopicLotteryPrizeImageReference(uploadedUrl)
  assert.equal(reference, '/cos/activities/asset-one/source.webp')
  assert.equal(resolveTopicLotteryPrizeImageSrc(reference), uploadedUrl)
  assert.equal(normalizeTopicLotteryConfig({ ...valid(), prizes: [{ ...valid().prizes[0], imageUrl: uploadedUrl }] }).prizes[0].imageUrl, reference)
})
test('legacy malformed or temporary prize image references are hidden safely on read without invalidating the lottery', () => {
  for (const imageUrl of ['blob:https://ecfc.fans/temporary-id', `${getMediaPublicBaseUrl()}/activities/asset-one/source.webp?signature=secret`]) {
    const config = normalizeTopicLotteryConfigForRead({ ...valid(), prizes: [{ ...valid().prizes[0], imageUrl }] })
    assert.equal(config.enabled, true)
    assert.equal(config.prizes[0].imageUrl, null)
    assert.equal(resolveTopicLotteryPrizeImageSrc(imageUrl), null)
  }
})
test('retention is explicit bounded 1..365 days', () => {
  assert.equal(normalizeTopicLotteryConfig(valid()).retentionDays, 90)
  for (const retentionDays of [0, 366, 1.2]) assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), retentionDays }), { code: 'LOTTERY_CONFIG_INVALID' })
})
test('participants lock eligibility and existing stock but allow presentation edits and new prize tiers', () => {
  const current = normalizeTopicLotteryConfig(valid())
  const next = normalizeTopicLotteryConfig({ ...current, title: '新标题', description: '更新说明', publishWinners: true,
    prizes: [{ ...current.prizes[0], name: '新奖品名称', description: '新展示说明', imageUrl: '/images/new-gift.png' },
      { id: 'gift-two', name: '新增奖品', description: '', imageUrl: null, quantity: 3, sortOrder: 1 }] })
  assert.doesNotThrow(() => assertTopicLotteryConfigUpdateAllowed(current, next, { participantsLocked: true, drawFrozen: false }))
  assert.throws(() => assertTopicLotteryConfigUpdateAllowed(current, normalizeTopicLotteryConfig({ ...current, sourceEntryIds: ['another-source'] }), { participantsLocked: true, drawFrozen: false }), { code: 'LOTTERY_RULES_LOCKED' })
  assert.throws(() => assertTopicLotteryConfigUpdateAllowed(current, normalizeTopicLotteryConfig({ ...current, prizes: [{ ...current.prizes[0], quantity: 3 }] }), { participantsLocked: true, drawFrozen: false }), { code: 'LOTTERY_RULES_LOCKED' })
  assert.throws(() => assertTopicLotteryConfigUpdateAllowed(current, normalizeTopicLotteryConfig({ ...current, prizes: [{ id: 'gift-two', name: '新增奖品', description: '', imageUrl: null, quantity: 1, sortOrder: 1 }] }), { participantsLocked: true, drawFrozen: false }), { code: 'LOTTERY_RULES_LOCKED' })
})
test('a frozen draw snapshot rejects every lottery config change', () => {
  const current = normalizeTopicLotteryConfig(valid())
  assert.doesNotThrow(() => assertTopicLotteryConfigUpdateAllowed(current, current, { participantsLocked: true, drawFrozen: true }))
  assert.throws(() => assertTopicLotteryConfigUpdateAllowed(current, normalizeTopicLotteryConfig({ ...current, title: '赛后改名' }), { participantsLocked: true, drawFrozen: true }), { code: 'LOTTERY_DRAW_FROZEN' })
})
function sourceRuleProgram(): TopicActivityV2Program {
  const program = createDefaultTopicActivityV2Program()
  program.enabled = true
  program.platformRewards.enabled = true
  const entry = (id: string, sortOrder: number): TopicActivityV2Program['entries'][number] => ({ id, platformKey: `platform-${id}`, platformName: id,
    title: '分享任务', instructions: '发布内容并上传截图', materialRequirement: '截图', minImages: 1, maxImages: 3, points: 96, enabled: true,
    sortOrder, startsAt: null, endsAt: null, allowResubmit: true })
  program.entries = [entry('source-one', 0), entry('unrelated-entry', 1)]
  return program
}
test('DRAWN and persisted participation evidence keep source rules locked', () => {
  const empty = { hasFairnessLock: false, hasSourceEvidence: false, hasEligibility: false, hasLotteryEntry: false, hasDrawSnapshot: false }
  assert.equal(topicLotterySourceRulesLocked({ state: 'COLLECTING', ...empty }), false)
  assert.equal(topicLotterySourceRulesLocked({ state: 'DRAWN', ...empty }), true)
  for (const evidence of ['hasFairnessLock', 'hasSourceEvidence', 'hasEligibility', 'hasLotteryEntry', 'hasDrawSnapshot'] as const) {
    assert.equal(topicLotterySourceRulesLocked({ state: 'COLLECTING', ...empty, [evidence]: true }), true)
  }
})
test('only qualification-relevant configured source entry fields are immutable', () => {
  const current = sourceRuleProgram(), sourceIds = ['source-one']
  const mutations: Array<(program: TopicActivityV2Program) => void> = [
    (program) => { program.entries[0].minImages = 0; program.entries[0].maxImages = 0 },
    (program) => { program.entries[0].enabled = false },
    (program) => { program.entries[0].allowResubmit = false },
    (program) => { program.entries[0].startsAt = '2026-10-20T00:00:00.000Z' },
    (program) => { program.entries[0].endsAt = '2026-10-21T00:00:00.000Z' },
    (program) => { program.entries[0].platformKey = 'different-platform' },
    (program) => { program.platformRewards.enabled = false },
    (program) => { program.enabled = false },
    (program) => { program.entries[0].id = 'replacement-source' },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(current)
    mutate(changed)
    assert.throws(() => assertTopicLotterySourceProgramRulesUnchanged(current, changed, sourceIds), { code: 'LOTTERY_SOURCE_RULES_LOCKED' })
  }
  const unrelatedEdit = structuredClone(current)
  unrelatedEdit.entries[1].maxImages = 5
  assert.doesNotThrow(() => assertTopicLotterySourceProgramRulesUnchanged(current, unrelatedEdit, sourceIds))
})
test('uniform secure shuffle: all three-user RNG paths yield each permutation once', () => {
  const permutations = new Set<string>()
  for (let first = 0; first < 3; first++) for (let second = 0; second < 2; second++) {
    const choices = [first, second], bounds: number[] = []
    permutations.add(sampleTopicLotteryUsers(['a', 'b', 'c'], 3, (max) => { bounds.push(max); return choices.shift()! }).join(''))
    assert.deepEqual(bounds, [3, 2])
  }
  assert.equal(permutations.size, 6)
})
test('one chance per user, bounded stock and no mutation of input candidates', () => {
  const users = ['a', 'b', 'c']
  assert.equal(new Set(sampleTopicLotteryUsers(users, 2)).size, 2)
  assert.deepEqual(users, ['a', 'b', 'c'])
  assert.equal(sampleTopicLotteryUsers(users, 100).length, 3)
  assert.deepEqual(sampleTopicLotteryUsers([], 4), [])
  assert.throws(() => sampleTopicLotteryUsers(['a', 'a'], 2), { code: 'LOTTERY_CANDIDATES_INVALID' })
  assert.throws(() => sampleTopicLotteryUsers(users, 2, () => -1), RangeError)
})
