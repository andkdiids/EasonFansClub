import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultTopicLotteryConfig, normalizeTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
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
  for (const imageUrl of ['/cos/topic-activity/private/original-photo.png', 'https://hostile.invalid/a.png', '/images/a.png?secret=value', '/images/%2e%2e/private.png'])
    assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), prizes: [{ ...valid().prizes[0], imageUrl }] }), { code: 'LOTTERY_CONFIG_INVALID' })
})
test('retention is explicit bounded 1..365 days', () => {
  assert.equal(normalizeTopicLotteryConfig(valid()).retentionDays, 90)
  for (const retentionDays of [0, 366, 1.2]) assert.throws(() => normalizeTopicLotteryConfig({ ...valid(), retentionDays }), { code: 'LOTTERY_CONFIG_INVALID' })
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
