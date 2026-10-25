import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, instant, rewardEntry } from './fixtures/topic-v2-transaction'
import { claimTopicActivityV2FixedReward, getTopicActivityV2View, getTopicActivityV2Statistics, grantTopicActivityV2MedalForEventInTransaction, reviewTopicActivityV2Submission, saveTopicActivityV2Program, submitTopicActivityV2Task, topicV2EntryGrantKey, withdrawTopicActivityV2Submission } from '@/lib/topic-activity-v2'
import { grantTopicActivityPointsInTransaction } from '@/lib/topic-activity-points'
import { prisma } from '@/lib/prisma'
import { withTopicV2Transaction } from '@/lib/topic-activity-v2'
import { canSubmitTopicActivityV2Entry, normalizeTopicActivityV2Progress } from '@/components/activities/topic-activity-v2-types'
const approve = (submissionId: string) => reviewTopicActivityV2Submission({ submissionId, reviewerId: 'admin-one', status: 'APPROVED', now: instant })

test('raw MySQL lock conflicts retry after rollback, but unrelated raw query failures do not retry', async () => {
  const original = prisma.$transaction
  try {
    for (const engineCode of ['1213', '1205']) {
      let calls = 0
      Reflect.set(prisma, '$transaction', async (operation: (tx: object) => Promise<unknown>) => {
        if (++calls < 3) throw { code: 'P2010', meta: { code: engineCode } }
        return operation({})
      })
      assert.equal(await withTopicV2Transaction(async () => 'committed'), 'committed')
      assert.equal(calls, 3)
    }
    let calls = 0
    Reflect.set(prisma, '$transaction', async () => { calls++; throw { code: 'P2010', meta: { code: '1064' } } })
    await assert.rejects(withTopicV2Transaction(async () => 'not reached'), { code: 'P2010' })
    assert.equal(calls, 1)
    calls = 0
    Reflect.set(prisma, '$transaction', async () => { calls++; throw { code: 'P2010', meta: { code: '1213' } } })
    await assert.rejects(withTopicV2Transaction(async () => 'not reached'), { code: 'P2010' })
    assert.equal(calls, 3)
  } finally { Reflect.set(prisma, '$transaction', original) }
})
test('same entry concurrent approvals use one ledger and one balance change (serialized transaction double)', async () => {
  const f = fixture(); f.submission('one'); f.submission('two')
  await f.run(async () => { await Promise.all([approve('one'), approve('one'), approve('two')]) })
  assert.equal(f.state.points, 196); assert.equal(f.state.logs.length, 1); assert.equal(f.state.grants.length, 1); assert.equal(f.state.reviews.length, 2)
  assert.equal(f.state.logs[0].before, 100); assert.equal(f.state.logs[0].after, 196)
  assert.ok(f.queries[0].includes('Activity')); assert.ok(f.queries.some((query) => query.includes('User') && query.includes('FOR UPDATE')))
})
test('different platforms stack; two entries on one platform occupy one platform slot', async () => {
  const entries = [rewardEntry('weibo-one', 'weibo'), rewardEntry('weibo-two', 'weibo'), rewardEntry('red', 'red')]
  const f = fixture(entries); f.program.platformRewards.maxPlatforms = 2; entries.forEach((entry) => f.submission(entry.id, entry))
  await f.run(async () => { for (const entry of entries) await approve(entry.id) })
  assert.equal(f.state.points, 388); assert.equal(f.state.grants.length, 3)
})
test('concurrent approvals cannot exceed distinct-platform cap (serialized transaction double)', async () => {
  const entries = [rewardEntry('weibo', 'weibo'), rewardEntry('red', 'red')]
  const f = fixture(entries); f.program.platformRewards.maxPlatforms = 1; entries.forEach((entry) => f.submission(entry.id, entry))
  const results = await f.run(() => Promise.allSettled(entries.map((entry) => approve(entry.id))))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(f.state.logs.length, 1); assert.equal(f.state.reviews.length, 1); assert.equal(f.state.points, 196)
  assert.equal(f.state.submissions.filter((row: { status: string }) => row.status === 'PENDING').length, 1)
})
test('separate entry cap can reject second same-platform entry', async () => {
  const f = fixture([rewardEntry('one', 'same'), rewardEntry('two', 'same')]); f.program.platformRewards.maxEntries = 1
  f.submission('one', f.program.entries[0]); f.submission('two', f.program.entries[1])
  await f.run(async () => { await approve('one'); await assert.rejects(approve('two'), { code: 'TOPIC_V2_MAX_ENTRIES_REACHED' }) })
  assert.equal(f.state.logs.length, 1)
})
test('non-stacking configuration counts one distinct platform, not one entry', async () => {
  const f = fixture([rewardEntry('one', 'same'), rewardEntry('two', 'same'), rewardEntry('three', 'other')]); f.program.platformRewards.allowStacking = false
  f.program.entries.forEach((entry) => f.submission(entry.id, entry))
  await f.run(async () => { await approve('one'); await approve('two'); await assert.rejects(approve('three'), { code: 'TOPIC_V2_MAX_PLATFORMS_REACHED' }) })
  assert.equal(f.state.logs.length, 2)
})
test('reversing/deleting a paid comment does not restore capacity or reissue points', async () => {
  const f = fixture([rewardEntry('one', 'weibo'), rewardEntry('two', 'red')]); f.program.platformRewards.maxPlatforms = 1
  f.submission('one', f.program.entries[0]); f.submission('two', f.program.entries[1])
  await f.run(async () => {
    await approve('one'); await reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'REJECTED', now: instant })
    await approve('one'); assert.equal(f.state.logs.length, 1)
    f.state.submissions[0].Comment.isDeleted = true
    await assert.rejects(approve('two'), { code: 'TOPIC_V2_MAX_PLATFORMS_REACHED' })
    await assert.rejects(approve('one'), { code: 'TOPIC_V2_SUBMISSION_UNAVAILABLE' })
  })
})
test('reward amount/instructions use submission snapshot after admin config changes', async () => {
  const f = fixture(); f.submission('one'); f.program.entries[0].points = 200; f.state.entries[0].config.points = 200
  await f.run(() => approve('one'))
  assert.equal(f.state.logs[0].points, 96); assert.equal(f.state.grants[0].rewardSnapshot.points, 96)
})
test('activity cancellation blocks review; expired but valid-time submission may be reviewed', async () => {
  const f = fixture(); f.submission('one'); f.activity.endsAt = new Date(instant.getTime() + 1)
  await f.run(() => reviewTopicActivityV2Submission({ submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED', now: new Date(instant.getTime() + 60000) }))
  const closed = fixture(); closed.submission('one'); closed.activity.status = 'CANCELLED'
  await closed.run(async () => { await assert.rejects(approve('one'), { code: 'ACTIVITY_CLOSED' }) }); assert.equal(closed.state.logs.length, 0)
})
test('submission/activity/post relation mismatch is rejected before review', async () => {
  const f = fixture(); f.submission('one').Comment.postId = 'wrong-post'
  await f.run(async () => {
    await assert.rejects(approve('one'), { code: 'TOPIC_V2_SUBMISSION_UNAVAILABLE' })
    await assert.rejects(reviewTopicActivityV2Submission({ activityId: 'other', submissionId: 'one', reviewerId: 'admin-one', status: 'APPROVED' }), { status: 404 })
  }); assert.equal(f.state.audits.length, 0)
})
test('direct V2 review rejects ordinary discussion submissions without mutating status, rewards, or audit records', async () => {
  const f = fixture()
  const submission = f.submission('discussion')
  Object.assign(submission, { rewardEntryId: null, rewardSnapshot: null })
  await f.run(async () => {
    for (const status of ['APPROVED', 'REJECTED'] as const) {
      await assert.rejects(reviewTopicActivityV2Submission({ submissionId: 'discussion', reviewerId: 'admin-one', status, now: instant }), {
        code: 'TOPIC_V2_DISCUSSION_NOT_REVIEWABLE', status: 409,
      })
    }
  })
  assert.equal(submission.status, 'PENDING')
  assert.equal(f.state.reviews.length, 0)
  assert.equal(f.state.audits.length, 0)
  assert.equal(f.state.grants.length, 0)
  assert.equal(f.state.logs.length, 0)
  assert.equal(f.state.points, 100)
})
test('fixed reward is independent, uses legacy business key, only once with atomic PointLog', async () => {
  const f = fixture(); f.program.fixedReward = { ...f.program.fixedReward, enabled: true, points: 74, condition: 'POLL', requiresReview: false }
  f.state.votes.push({ activityId: f.activity.id, pollId: f.program.poll.id, userId: 'user-one', createdAt: instant })
  await f.run(async () => { await Promise.all([1, 2].map(() => claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', now: instant }))) })
  assert.equal(f.state.points, 174); assert.equal(f.state.grants[0].rewardEntryId, null)
  assert.equal(f.state.logs[0].businessKey, 'topic-activity:activity-one:user-one:points')
})
test('legacy granted fixed reward remains deduplicated after V2 enablement', async () => {
  const f = fixture(); f.state.grants.push({ id: 'legacy', grantKey: 'topic-activity:activity-one:user-one:points', status: 'GRANTED', origin: 'LEGACY' })
  const result = await f.run(() => claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', now: instant }))
  assert.equal(result.changed, false); assert.equal(f.state.logs.length, 0)
})
test('manual fixed claim snapshot remains 74 despite config change, no automatic award', async () => {
  const f = fixture(); f.program.fixedReward = { ...f.program.fixedReward, enabled: true, points: 74, condition: 'ADMIN_REVIEW', requiresReview: true }
  await f.run(async () => {
    await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', now: instant })
    assert.equal(f.state.logs.length, 0); f.program.fixedReward.points = 999
    await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'APPROVED', now: instant })
  }); assert.equal(f.state.points, 174); assert.equal(f.state.audits.length, 1)
})
test('manual fixed decision requires actual claim and reject never pays', async () => {
  const f = fixture(); f.program.fixedReward = { ...f.program.fixedReward, enabled: true, points: 74, condition: 'ADMIN_REVIEW', requiresReview: true }
  await f.run(async () => {
    await assert.rejects(claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'APPROVED', now: instant }), { code: 'TOPIC_V2_CLAIM_NOT_FOUND' })
    await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', now: instant })
    await claimTopicActivityV2FixedReward({ activityId: f.activity.id, userId: 'user-one', reviewerId: 'admin-one', decision: 'REJECTED', now: instant })
  }); assert.equal(f.state.logs.length, 0); assert.equal(f.state.grants[0].status, 'CANCELLED')
})
test('medal events are independent and previous medal protects once even after binding changes', async () => {
  const f = fixture(); f.program.medal = { enabled: true, badgeId: 'new-badge', triggers: ['PLATFORM', 'POLL', 'TEST'], description: '', allowLateReview: true }
  f.state.grants.push({ id: 'original-medal', activityId: f.activity.id, userId: 'user-one', kind: 'BADGE', origin: 'LEGACY', status: 'GRANTED' })
  for (const event of ['PLATFORM', 'POLL', 'TEST'] as const) {
    const grant = await grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, { userId: 'user-one', event, effectiveAt: instant, now: instant })
    assert.equal(grant?.id, 'original-medal')
  } assert.equal(f.state.grants.length, 1)
})
test('medal ignores wrong trigger and late review honors configured event time policy', async () => {
  const f = fixture(); f.program.medal = { enabled: true, badgeId: 'badge', triggers: ['PLATFORM'], description: '', allowLateReview: false }; f.activity.endsAt = instant
  const args = { userId: 'user-one', event: 'PLATFORM' as const, effectiveAt: instant, now: new Date(instant.getTime() + 1) }
  assert.equal(await grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, args), null)
  assert.equal(await grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, { ...args, event: 'POLL', now: instant }), null)
  f.program.medal.allowLateReview = true; f.state.grants.push({ id: 'existing', activityId: f.activity.id, userId: 'user-one', kind: 'BADGE', status: 'GRANTED' })
  assert.equal((await grantTopicActivityV2MedalForEventInTransaction(f.tx, f.activity, args))?.id, 'existing')
})
test('rejected task can resubmit and retains history; pending repeat denied', async () => {
  const f = fixture(); f.submission('old').status = 'REJECTED'
  await f.run(async () => {
    const result = await submitTopicActivityV2Task({ activityId: f.activity.id, userId: 'user-one', rewardEntryId: 'weibo', now: instant })
    assert.equal(result.commentId, 'reply-1'); assert.equal(f.state.submissions[0].status, 'REJECTED'); assert.equal(f.state.submissions[1].rewardSnapshot.points, 96)
    await assert.rejects(submitTopicActivityV2Task({ activityId: f.activity.id, userId: 'user-one', rewardEntryId: 'weibo', now: instant }), { code: 'TOPIC_V2_RESUBMISSION_NOT_ALLOWED' })
  })
})
test('only the owner can withdraw their pending platform task; history/assets stay and no reward is issued', async () => {
  const f = fixture([rewardEntry('weibo', 'weibo'), rewardEntry('red', 'xiaohongshu')])
  const target = f.submission('submission-weibo', f.program.entries[0])
  const otherPlatform = f.submission('submission-red', f.program.entries[1])
  f.state.assets.push({ id: 'private-image', taskSubmissionId: target.id, storageKey: 'retained-object-key' })
  f.tx.activity.findUnique = async ({ where }: { where: { id: string } }) => where.id === f.activity.id ? f.activity : null
  await f.run(async () => {
    await assert.rejects(withdrawTopicActivityV2Submission({ activityId: f.activity.id, submissionId: target.id, userId: 'another-user', now: instant }), { code: 'TOPIC_V2_SUBMISSION_NOT_FOUND', status: 404 })
    await assert.rejects(withdrawTopicActivityV2Submission({ activityId: 'another-activity', submissionId: target.id, userId: 'user-one', now: instant }), { code: 'TOPIC_V2_ACTIVITY_NOT_FOUND', status: 404 })
    const result = await withdrawTopicActivityV2Submission({ activityId: f.activity.id, submissionId: target.id, userId: 'user-one', now: instant })
    assert.deepEqual(result, { ok: true, submissionId: target.id, status: 'WITHDRAWN' })
    assert.equal(f.state.submissions.find((row: { id: string }) => row.id === target.id)?.status, 'WITHDRAWN')
    assert.equal(f.state.submissions.find((row: { id: string }) => row.id === target.id)?.commentDeletedAt, null)
    assert.equal(f.state.submissions.find((row: { id: string }) => row.id === otherPlatform.id)?.status, 'PENDING')
    assert.equal(f.state.reviews.length, 1)
    assert.equal(f.state.reviews[0].fromStatus, 'PENDING')
    assert.equal(f.state.reviews[0].toStatus, 'WITHDRAWN')
    assert.equal(f.state.reviews[0].reviewedById, null)
    assert.equal(f.state.assets[0].taskSubmissionId, target.id)
    assert.equal(f.state.grants.length, 0)
    assert.equal(f.state.logs.length, 0)
    assert.equal(f.state.points, 100)
  })
})
test('withdrawal cannot change approved, rejected or already withdrawn history', async () => {
  for (const status of ['APPROVED', 'REJECTED', 'WITHDRAWN']) {
    const f = fixture()
    const submission = f.submission('one'); submission.status = status
    await f.run(async () => {
      await assert.rejects(withdrawTopicActivityV2Submission({ activityId: f.activity.id, submissionId: submission.id, userId: 'user-one', now: instant }), { code: 'TOPIC_V2_SUBMISSION_NOT_PENDING', status: 409 })
    })
    assert.equal(submission.status, status)
    assert.equal(f.state.reviews.length, 0)
    assert.equal(f.state.grants.length, 0)
  }
})
test('withdrawal audit failure rolls back the status transition and retains its assets', async () => {
  const f = fixture(); const submission = f.submission('one')
  f.state.assets.push({ id: 'private-image', taskSubmissionId: submission.id, storageKey: 'retained-object-key' })
  f.tx.topicActivityReviewLog.create = async () => { throw Object.assign(new Error('controlled audit write failure'), { code: 'FIXTURE_AUDIT_WRITE_FAILED' }) }
  await f.run(async () => {
    await assert.rejects(withdrawTopicActivityV2Submission({ activityId: f.activity.id, submissionId: submission.id, userId: 'user-one', now: instant }), { code: 'FIXTURE_AUDIT_WRITE_FAILED' })
  })
  assert.equal(f.state.submissions[0].status, 'PENDING')
  assert.equal(f.state.reviews.length, 0)
  assert.equal(f.state.assets[0].taskSubmissionId, submission.id)
  assert.equal(f.state.grants.length, 0)
})
test('withdrawal and administrator review serialize: exactly one PENDING transition wins', async () => {
  const f = fixture(); const submission = f.submission('one')
  const outcomes = await f.run(() => Promise.allSettled([
    withdrawTopicActivityV2Submission({ activityId: f.activity.id, submissionId: submission.id, userId: 'user-one', now: instant }),
    approve('one'),
  ]))
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1)
  assert.ok(['WITHDRAWN', 'APPROVED'].includes(submission.status))
  assert.equal(f.state.reviews.length, 1)
  if (submission.status === 'WITHDRAWN') {
    assert.equal(f.state.reviews[0].toStatus, 'WITHDRAWN')
    assert.equal(f.state.grants.length, 0)
    await f.run(async () => { await assert.rejects(approve('one'), { code: 'TOPIC_V2_SUBMISSION_WITHDRAWN', status: 409 }) })
  } else {
    assert.equal(f.state.reviews[0].toStatus, 'APPROVED')
    assert.equal(f.state.grants.length, 1)
    await f.run(async () => { await assert.rejects(withdrawTopicActivityV2Submission({ activityId: f.activity.id, submissionId: submission.id, userId: 'user-one', now: instant }), { code: 'TOPIC_V2_SUBMISSION_NOT_PENDING', status: 409 }) })
  }
})
test('when administrator review wins the race, a later withdrawal cannot revert approval or rewards', async () => {
  const f = fixture(); const submission = f.submission('one')
  let signalReviewApplied!: () => void
  const reviewApplied = new Promise<void>((resolve) => { signalReviewApplied = resolve })
  const updateMany = f.tx.topicActivitySubmission.updateMany
  f.tx.topicActivitySubmission.updateMany = async (args: { data?: { status?: string }; where?: unknown }) => {
    const result = await updateMany(args)
    if (args.data?.status === 'APPROVED') signalReviewApplied()
    return result
  }
  const outcomes = await f.run(async () => {
    const review = approve('one')
    await reviewApplied
    const withdrawal = withdrawTopicActivityV2Submission({ activityId: f.activity.id, submissionId: submission.id, userId: 'user-one', now: instant })
    return Promise.allSettled([review, withdrawal])
  })
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(f.state.submissions[0].status, 'APPROVED')
  assert.equal(f.state.reviews.length, 1)
  assert.equal(f.state.reviews[0].toStatus, 'APPROVED')
  assert.equal(f.state.grants.length, 1)
  assert.equal(f.state.points, 196)
  assert.equal(f.state.assets.length, 0)
})
test('administrator review uses a conditional state transition and aborts rewards when another writer wins', async () => {
  const f = fixture(); const submission = f.submission('one')
  const updateMany = f.tx.topicActivitySubmission.updateMany
  f.tx.topicActivitySubmission.updateMany = async (args: { data?: { status?: string }; where?: unknown }) => args.data?.status === 'APPROVED' ? { count: 0 } : updateMany(args)
  await f.run(async () => {
    await assert.rejects(approve('one'), { code: 'TOPIC_V2_SUBMISSION_STATE_CHANGED', status: 409 })
  })
  assert.equal(submission.status, 'PENDING')
  assert.equal(f.state.reviews.length, 0)
  assert.equal(f.state.audits.length, 0)
  assert.equal(f.state.grants.length, 0)
  assert.equal(f.state.logs.length, 0)
  assert.equal(f.state.points, 100)
})
test('two concurrent withdrawal requests produce one audited transition, then withdrawn attempt can be resubmitted', async () => {
  const entry = rewardEntry('weibo', 'weibo'); entry.allowResubmit = false
  const f = fixture([entry]); const original = f.submission('old')
  const outcomes = await f.run(() => Promise.allSettled([1, 2].map(() => withdrawTopicActivityV2Submission({ activityId: f.activity.id, submissionId: original.id, userId: 'user-one', now: instant }))))
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(f.state.reviews.length, 1)
  assert.equal(original.status, 'WITHDRAWN')
  await f.run(async () => {
    const next = await submitTopicActivityV2Task({ activityId: f.activity.id, userId: 'user-one', rewardEntryId: entry.id, now: instant })
    assert.equal(next.submission.status, 'PENDING')
  })
  assert.equal(f.state.submissions.length, 2)
  assert.deepEqual(f.state.submissions.map((row: { status: string }) => row.status), ['WITHDRAWN', 'PENDING'])
  assert.equal(f.state.grants.length, 0)
  assert.equal(f.state.points, 100)
})
test('withdrawn progress follows the newest non-approved attempt while prior approved progress remains durable', () => {
  const withdrawn = normalizeTopicActivityV2Progress({ submissions: [
    { id: 'new-withdrawn', rewardEntryId: 'weibo', status: 'WITHDRAWN', submittedAt: '2026-10-13T05:00:00.000Z' },
    { id: 'old-pending', rewardEntryId: 'weibo', status: 'PENDING', submittedAt: '2026-10-13T04:00:00.000Z' },
  ] })[0]
  assert.equal(withdrawn.status, 'WITHDRAWN')
  assert.equal(withdrawn.submissionId, 'new-withdrawn')
  assert.equal(canSubmitTopicActivityV2Entry(withdrawn.status, false), true)
  const approved = normalizeTopicActivityV2Progress({ submissions: [
    { id: 'new-withdrawn', rewardEntryId: 'weibo', status: 'WITHDRAWN', submittedAt: '2026-10-13T05:00:00.000Z' },
    { id: 'old-approved', rewardEntryId: 'weibo', status: 'APPROVED', submittedAt: '2026-10-13T04:00:00.000Z' },
  ] })[0]
  assert.equal(approved.status, 'APPROVED')
  assert.equal(approved.submissionId, 'old-approved')
})
test('form gate cannot be bypassed by platform entry; duplicate/foreign screenshot rejected', async () => {
  const f = fixture(); f.activity.participationMode = 'FORM'
  await f.run(async () => { await assert.rejects(submitTopicActivityV2Task({ activityId: f.activity.id, userId: 'user-one', rewardEntryId: 'weibo', now: instant }), { code: 'FORM_REQUIRED_BEFORE_COMMENT' }) })
  f.activity.participationMode = 'COMMENT'; f.state.entries[0].config.maxImages = 2
  await f.run(async () => {
    await assert.rejects(submitTopicActivityV2Task({ activityId: f.activity.id, userId: 'user-one', rewardEntryId: 'weibo', assetIds: ['x', 'x'], now: instant }), { code: 'TOPIC_V2_DUPLICATE_ASSET' })
    await assert.rejects(submitTopicActivityV2Task({ activityId: f.activity.id, userId: 'user-one', rewardEntryId: 'weibo', assetIds: ['other-owner'], now: instant }), { code: 'TOPIC_V2_ASSET_NOT_AUTHORIZED' })
  }); assert.equal(f.state.submissions.length, 0)
})
test('saving entries archives omitted history, rejects cross-activity ownership and immutable platform', async () => {
  const f = fixture(); f.submission('one')
  await f.run(async () => {
    await assert.rejects(saveTopicActivityV2Program(f.activity.id, 'admin-one', { ...f.program, entries: [{ ...f.program.entries[0], platformKey: 'other' }] }), { code: 'TOPIC_V2_PLATFORM_ID_IMMUTABLE' })
    const value = await saveTopicActivityV2Program(f.activity.id, 'admin-one', { ...f.program, entries: [] })
    assert.equal(value.entries[0].enabled, false); assert.equal(f.state.entries.length, 1)
  })
  const cross = fixture(); cross.state.entries[0].activityId = 'other'
  await cross.run(async () => { await assert.rejects(saveTopicActivityV2Program(cross.activity.id, 'admin-one', cross.program), { code: 'TOPIC_V2_ENTRY_RELATION_INVALID' }) })
})
test('user totals are full counts while private submissions bounded and public answers hidden', async () => {
  const f = fixture(); for (let index = 0; index < 110; index++) f.submission(String(index))
  const view = await f.run(() => getTopicActivityV2View(f.activity.id, 'user-one'))
  assert.equal(view.myProgress?.submittedCount, 110); assert.equal((view.myProgress?.submissions as unknown[]).length, 100)
  assert.ok(!JSON.stringify(view.program).includes('correctOptionId')); assert.ok(!('topicProgram' in view.activity))
})
test('admin statistics distinguish unique users, votes, entries and reward counts', async () => {
  const f = fixture(); f.submission('one'); f.submission('two')
  f.state.votes.push({ activityId: f.activity.id, userId: 'user-one', pollId: 'poll-one', choices: ['a'] }, { activityId: f.activity.id, userId: 'user-two', pollId: 'poll-one', choices: ['a', 'b'] })
  const stats = await f.run(() => getTopicActivityV2Statistics(f.activity.id))
  assert.equal(stats.submittedUsers, 1); assert.equal(stats.submissionCount, 2); assert.equal(stats.pollParticipants, 2)
  assert.equal(stats.pollResults[0].count, 2); assert.equal(stats.pollResults[1].percentage, 50)
})
test('points helper rejects invalid/overflow balances and does not replay prior ledger', async () => {
  const f = fixture(); const input = { activityId: f.activity.id, userId: 'user-one', businessKey: 'key', points: 7, reason: '本地奖励', now: instant }
  await grantTopicActivityPointsInTransaction(f.tx, input); await grantTopicActivityPointsInTransaction(f.tx, input)
  assert.equal(f.state.points, 107); assert.equal(f.state.logs.length, 1)
  await assert.rejects(grantTopicActivityPointsInTransaction(f.tx, { ...input, businessKey: 'invalid', points: -1 }))
  f.state.points = 2147483647
  await assert.rejects(grantTopicActivityPointsInTransaction(f.tx, { ...input, businessKey: 'overflow' }), /BALANCE_LIMIT/)
  assert.equal(f.state.logs.length, 1); assert.notEqual(topicV2EntryGrantKey('a:b', 'c', 'u'), topicV2EntryGrantKey('a', 'b:c', 'u'))
})
