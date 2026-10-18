import assert from 'node:assert/strict'
import test from 'node:test'
import { claimTopicActivityV2FixedReward, dispatchDueTopicActivityV2Rewards, grantTopicActivityV2MedalForEventInTransaction, reviewTopicActivityV2Submission } from '@/lib/topic-activity-v2'
import { reviewTopicActivitySubmission } from '@/lib/topic-activity'
import { fixture, instant, rewardEntry } from './fixtures/topic-v2-transaction'
import { topicRewardReleaseDue } from '@/lib/topic-activity-reward-timing'

const now = new Date('2026-10-19T00:00:00.000Z')

test('IMMEDIATE releases a Topic V2 reward regardless of rewardGrantAt', () => {
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: 'IMMEDIATE', rewardGrantAt: new Date('2099-01-01T00:00:00Z') }, now), true)
})

test('SCHEDULED releases only at or after a valid release time', () => {
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: 'SCHEDULED', rewardGrantAt: '2026-10-18T23:59:59.999Z' }, now), true)
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: 'SCHEDULED', rewardGrantAt: now }, now), true)
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: 'SCHEDULED', rewardGrantAt: '2026-10-19T00:00:00.001Z' }, now), false)
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: 'SCHEDULED', rewardGrantAt: '2026-11-03T20:00' }, new Date('2026-11-03T12:00:00.000Z')), true)
})

test('missing, invalid, and unknown timing values fail closed', () => {
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: 'SCHEDULED', rewardGrantAt: null }, now), false)
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: 'SCHEDULED', rewardGrantAt: 'not-a-date' }, now), false)
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: 'UNKNOWN', rewardGrantAt: now }, now), false)
  assert.equal(topicRewardReleaseDue({ rewardGrantMode: undefined, rewardGrantAt: now }, now), false)
})

test('scheduled approval stays pending, releases at due time, and is idempotent', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000); f.submission('one')
  await f.run(() => reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED', now: instant }))
  assert.equal(f.state.points, 100); assert.equal(f.state.grants[0].status, 'PENDING')
  await f.run(() => dispatchDueTopicActivityV2Rewards({ now: instant }))
  assert.equal(f.state.points, 100); assert.equal(f.state.grants[0].status, 'PENDING')
  await f.run(() => dispatchDueTopicActivityV2Rewards({ now: new Date(instant.getTime() + 60_000) }))
  assert.equal(f.state.points, 196); assert.equal(f.state.grants[0].status, 'GRANTED'); assert.equal(f.state.logs.length, 1)
  await f.run(() => dispatchDueTopicActivityV2Rewards({ now: new Date(instant.getTime() + 120_000) }))
  assert.equal(f.state.points, 196); assert.equal(f.state.logs.length, 1)
})

test('legacy review delegates to V2 while preserving scheduled timing', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000); f.submission('one')
  await f.run(() => reviewTopicActivitySubmission({ submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED', now: instant }))
  assert.equal(f.state.submissions[0].status, 'APPROVED'); assert.equal(f.state.points, 100); assert.equal(f.state.grants[0].status, 'PENDING')
})

test('changing a pending scheduled Activity to IMMEDIATE releases it on the next heartbeat', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000); f.submission('one')
  await f.run(() => reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED', now: instant }))
  f.activity.rewardGrantMode = 'IMMEDIATE'; f.activity.rewardGrantAt = null
  await f.run(() => dispatchDueTopicActivityV2Rewards({ now: instant }))
  assert.equal(f.state.grants[0].status, 'GRANTED'); assert.equal(f.state.points, 196)
})

test('future medal creation refreshes participation while remaining pending', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000)
  f.program.medal = { ...f.program.medal, enabled: true, badgeId: 'badge-one', triggers: ['PLATFORM'] }
  const grant = await grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, { userId: 'user-one', event: 'PLATFORM', rewardEntryId: 'weibo', effectiveAt: instant, now: instant })
  assert.equal(grant?.status, 'PENDING'); assert.equal(f.state.participations[0].rewardStatus, 'PENDING')
})

test('future POLL medal snapshot keeps the original poll identity', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000)
  f.program.medal = { ...f.program.medal, enabled: true, badgeId: 'badge-one', triggers: ['POLL'] }
  const grant = await grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, { userId: 'user-one', event: 'POLL', effectiveAt: instant, now: instant })
  f.program.poll.id = 'new-poll-version'; f.program.poll.enabled = false
  const snapshot = grant?.rewardSnapshot
  assert.equal(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? (snapshot as { pollId?: string }).pollId : undefined, 'poll-one')
})

test('pending platform reservations occupy the entry cap before payout', async () => {
  const f = fixture([rewardEntry('one'), rewardEntry('two')]); f.program.platformRewards.maxEntries = 1
  f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000)
  f.submission('one', f.program.entries[0]); f.submission('two', f.program.entries[1])
  await f.run(async () => {
    await reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED', now: instant })
    await assert.rejects(reviewTopicActivityV2Submission({ submissionId: 'two', reviewerId: 'admin-one', status: 'APPROVED', now: instant }), { code: 'TOPIC_V2_MAX_ENTRIES_REACHED' })
  })
  assert.equal(f.state.points, 100); assert.equal(f.state.grants.length, 1); assert.equal(f.state.grants[0].status, 'PENDING')
})

test('rejecting one submission does not cancel a reservation backed by another approved submission', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000)
  f.submission('one'); f.submission('two')
  await f.run(async () => {
    await reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED', now: instant })
    await reviewTopicActivityV2Submission({ submissionId: 'two', reviewerId: 'admin-one', status: 'APPROVED', now: instant })
    await reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'REJECTED', now: instant })
  })
  assert.equal(f.state.grants[0].status, 'PENDING')
  await f.run(() => dispatchDueTopicActivityV2Rewards({ now: new Date(instant.getTime() + 60_000) }))
  assert.equal(f.state.grants[0].status, 'GRANTED'); assert.equal(f.state.points, 196)
})

test('unapproved fixed reward never dispatches, then approved pending reward pays', async () => {
  const f = fixture(); f.program.fixedReward = { ...f.program.fixedReward, enabled: true, points: 74, condition: 'ADMIN_REVIEW', requiresReview: true }
  await f.run(async () => {
    await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', now: instant })
    await dispatchDueTopicActivityV2Rewards({ now: instant })
    assert.equal(f.state.points, 100); assert.equal(f.state.grants[0].status, 'PENDING')
    await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'APPROVED', now: instant })
  })
  assert.equal(f.state.points, 174); assert.equal(f.state.grants[0].status, 'GRANTED')
})

test('repeating the same FIXED approval is a no-op without another audit', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000)
  f.program.fixedReward = { ...f.program.fixedReward, enabled: true, points: 74, condition: 'ADMIN_REVIEW', requiresReview: true }
  await f.run(async () => {
    await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', now: instant })
    await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'APPROVED', now: instant })
    const repeat = await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'APPROVED', now: instant })
    assert.equal(repeat.changed, false); assert.equal(f.state.audits.length, 1); assert.equal(f.state.grants[0].status, 'PENDING')
  })
})

test('rejected platform reservation cancels, re-approval restores it, and fixed cancellation is terminal', async () => {
  const platform = fixture(); platform.activity.rewardGrantMode = 'SCHEDULED'; platform.activity.rewardGrantAt = new Date(instant.getTime() + 60_000); platform.submission('one')
  await platform.run(async () => {
    await reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED', now: instant })
    await reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'REJECTED', now: instant })
  })
  assert.equal(platform.state.grants[0].status, 'CANCELLED')
  platform.activity.rewardGrantMode = 'IMMEDIATE'; platform.activity.rewardGrantAt = null
  await platform.run(() => reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED', now: instant }))
  assert.equal(platform.state.points, 196); assert.equal(platform.state.grants[0].status, 'GRANTED')

  const fixed = fixture(); fixed.program.fixedReward = { ...fixed.program.fixedReward, enabled: true, points: 74, condition: 'ADMIN_REVIEW', requiresReview: true }
  await fixed.run(async () => {
    await claimTopicActivityV2FixedReward({ activityId: fixed.activity.id, userId: 'user-one', now: instant })
    await claimTopicActivityV2FixedReward({ activityId: fixed.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'REJECTED', now: instant })
    const duplicate = await claimTopicActivityV2FixedReward({ activityId: fixed.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'APPROVED', now: instant })
    assert.equal(duplicate.changed, false); assert.equal(fixed.state.audits.length, 1)
  })
  assert.equal(fixed.state.grants[0].status, 'CANCELLED'); assert.equal(fixed.state.points, 100)
})

test('dispatcher retries a failed points grant and uses the original poll snapshot identity', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000)
  f.program.fixedReward = { ...f.program.fixedReward, enabled: true, points: 74, condition: 'POLL', requiresReview: true }
  f.state.votes.push({ activityId: f.activity.id, pollId: f.program.poll.id, userId: 'user-one', createdAt: instant })
  await f.run(async () => { await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', now: instant }) })
  f.program.poll.id = 'new-poll-version'; f.program.poll.enabled = false; f.state.points = 2_147_483_647
  await f.run(() => claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'APPROVED', now: instant }))
  await f.run(() => dispatchDueTopicActivityV2Rewards({ now: new Date(instant.getTime() + 60_000) }))
  assert.equal(f.state.grants[0].status, 'FAILED')
  f.state.points = 100
  await f.run(() => dispatchDueTopicActivityV2Rewards({ now: new Date(instant.getTime() + 60_000) }))
  assert.equal(f.state.grants[0].status, 'GRANTED'); assert.equal(f.state.points, 174)
})

test('fixed TEST evidence uses its snapshot identity after the test is replaced', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 60_000)
  f.program.fixedReward = { ...f.program.fixedReward, enabled: true, points: 74, condition: 'TEST', requiresReview: true }
  f.state.attempts.push({ activityId: f.activity.id, testId: f.program.test.id, configVersion: f.program.test.version, userId: 'user-one', completedAt: instant })
  await f.run(() => claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', now: instant }))
  f.program.test.id = 'new-test-version'; f.program.test.version = 2; f.program.test.enabled = false
  await f.run(() => claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'APPROVED', now: instant }))
  await f.run(() => dispatchDueTopicActivityV2Rewards({ now: new Date(instant.getTime() + 60_000) }))
  assert.equal(f.state.grants[0].status, 'GRANTED'); assert.equal(f.state.points, 174)
})

test('past scheduled review grants immediately and duplicate approval never pays twice', async () => {
  const f = fixture(); f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() - 1); f.submission('past')
  await f.run(async () => {
    for (let run = 0; run < 2; run++) await reviewTopicActivityV2Submission({ submissionId: 'past', reviewerId: 'admin-one', status: 'APPROVED', now: instant })
  })
  assert.equal(f.state.grants[0].status, 'GRANTED'); assert.equal(f.state.points, 196); assert.equal(f.state.logs.length, 1)
})

test('changing an unpaid future time takes effect; concurrent dispatchers and later timing changes cannot repay', async () => {
  const f = fixture(); const oldDue = new Date(instant.getTime() + 60_000), newDue = new Date(instant.getTime() + 120_000)
  f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = oldDue; f.submission('rescheduled')
  await f.run(async () => {
    await reviewTopicActivityV2Submission({ submissionId: 'rescheduled', reviewerId: 'admin-one', status: 'APPROVED', now: instant })
    f.activity.rewardGrantAt = newDue
    await dispatchDueTopicActivityV2Rewards({ now: oldDue })
    assert.equal(f.state.logs.length, 0)
    await Promise.all([dispatchDueTopicActivityV2Rewards({ now: newDue }), dispatchDueTopicActivityV2Rewards({ now: newDue })])
    assert.equal(f.state.logs.length, 1)
    f.activity.rewardGrantMode = 'IMMEDIATE'; await dispatchDueTopicActivityV2Rewards({ now: newDue })
    f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(newDue.getTime() + 60_000)
    await dispatchDueTopicActivityV2Rewards({ now: f.activity.rewardGrantAt })
  })
  assert.equal(f.state.logs.length, 1); assert.equal(f.state.points, 196)
})

test('old unreviewed FIXED rows cannot starve an eligible platform reward with batch size one', async () => {
  const f = fixture(); f.submission('eligible')
  f.activity.rewardGrantMode = 'SCHEDULED'; f.activity.rewardGrantAt = new Date(instant.getTime() + 1)
  await f.run(async () => {
    await reviewTopicActivityV2Submission({ submissionId: 'eligible', reviewerId: 'admin-one', status: 'APPROVED', now: instant })
    f.state.grants.push({ id: '000-first-unreviewed', activityId: f.activity.id, origin: 'FIXED', status: 'PENDING', rewardSnapshot: { approvalStatus: 'PENDING' } })
    await dispatchDueTopicActivityV2Rewards({ now: f.activity.rewardGrantAt, batchSize: 1 })
  })
  assert.equal(f.state.logs.length, 1)
  assert.equal(f.state.grants.find((row: { id: string }) => row.id === '000-first-unreviewed').status, 'PENDING')
})
