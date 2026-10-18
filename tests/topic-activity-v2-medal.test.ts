import assert from 'node:assert/strict'
import Module from 'node:module'
import { after, before, test } from 'node:test'
import { fixture, instant } from './fixtures/topic-v2-transaction'

const loader = Module as unknown as { _load: (request: string, parent?: unknown, main?: boolean) => unknown }
const original = loader._load
let service: typeof import('@/lib/topic-activity-v2')
let badgeCalls = 0, effects = 0
let lastGrant: Record<string, unknown> = {}
before(async () => {
  loader._load = function (request, parent, main) {
    if (request === '@/lib/badge-service') return { grantBadgeWithTransaction: async (_tx: unknown, input: Record<string, unknown>) => {
      badgeCalls++; lastGrant = input
      return { created: true, skipped: false, badgeId: input.badgeId, recordId: 'record-one', userId: input.userId }
    } }
    if (request === '@/lib/badge-phase3') return { processBadgeGrantEffects: async () => { effects++ } }
    return original.call(this, request, parent, main)
  }
  service = await import('@/lib/topic-activity-v2')
})
after(() => { loader._load = original })
test('first qualifying platform event delegates badge grant once and defers effects until commit', async () => {
  badgeCalls = 0; effects = 0
  const f = fixture(); f.program.medal = { enabled: true, badgeId: 'badge-one', triggers: ['PLATFORM', 'POLL'], description: '', allowLateReview: true }
  const invoke = () => service.grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, { userId: 'user-one', event: 'PLATFORM', effectiveAt: instant, now: instant })
  await f.run(async () => {
    await service.withTopicV2Transaction(async () => { await invoke(); assert.equal(effects, 0) })
    await service.withTopicV2Transaction(invoke)
  })
  assert.equal(badgeCalls, 1); assert.equal(effects, 1); assert.equal(f.state.grants.length, 1)
  assert.equal(lastGrant.sourceType, 'TOPIC_ACTIVITY_REWARD'); assert.equal(lastGrant.availabilityMode, 'HISTORICAL_WINDOW')
})
test('valid-time late review uses effective event time in existing badge service', async () => {
  badgeCalls = 0
  const f = fixture(); f.activity.endsAt = instant; f.program.medal = { enabled: true, badgeId: 'badge-one', triggers: ['PLATFORM'], description: '', allowLateReview: true }
  await f.run(() => service.withTopicV2Transaction(() => service.grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, { userId: 'user-one', event: 'PLATFORM', effectiveAt: instant, now: new Date(instant.getTime() + 60000) })))
  assert.equal(badgeCalls, 1); assert.deepEqual(lastGrant.obtainedAt, instant)
})
test('failed parent transaction rolls ledger back and never emits deferred badge effects', async () => {
  effects = 0
  const f = fixture(); f.program.medal = { enabled: true, badgeId: 'badge-one', triggers: ['PLATFORM'], description: '', allowLateReview: true }
  await f.run(async () => {
    await assert.rejects(service.withTopicV2Transaction(async () => {
      await service.grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, { userId: 'user-one', event: 'PLATFORM', effectiveAt: instant, now: instant })
      throw new Error('parent failed')
    }), /parent failed/)
  }); assert.equal(effects, 0); assert.equal(f.state.grants.length, 0)
})

test('scheduled medal waits, preserves earned poll identity, and grants once with after-commit effects', async () => {
  badgeCalls = 0; effects = 0
  const f = fixture(), due = new Date(instant.getTime() + 60000)
  f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = due
  f.program.medal = { enabled: true, badgeId: 'badge-one', triggers: ['POLL'], description: '', allowLateReview: true }
  f.state.votes.push({ activityId: f.activity.id, pollId: f.program.poll.id, userId: 'user-one', createdAt: instant })
  await f.run(async () => {
    await service.withTopicV2Transaction(() => service.grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, { userId: 'user-one', event: 'POLL', effectiveAt: instant, now: instant }))
    assert.equal(badgeCalls, 0); assert.equal(effects, 0); assert.equal(f.state.grants[0].status, 'PENDING')
    f.program.poll.id = 'new-poll'; f.program.poll.enabled = false
    await Promise.all([service.dispatchDueTopicActivityV2Rewards({ now: due }), service.dispatchDueTopicActivityV2Rewards({ now: due })])
  })
  assert.equal(badgeCalls, 1); assert.equal(effects, 1); assert.equal(f.state.grants[0].status, 'GRANTED')
})
